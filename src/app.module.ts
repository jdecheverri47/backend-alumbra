import { unwrapResolverError } from '@apollo/server/errors';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { HttpException, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { Request, Response } from 'express';
import { GraphQLFormattedError } from 'graphql';
import { join } from 'path';
import { AccessRequestsModule } from './access-requests/access-requests.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { CoursesModule } from './courses/courses.module';
import { EventsModule } from './events/events.module';
import { FeedModule } from './feed/feed.module';
import { GroupSessionsModule } from './group-sessions/group-sessions.module';
import { GroupsModule } from './groups/groups.module';
import { MembershipModule } from './membership/membership.module';
import { MinistriesModule } from './ministries/ministries.module';
import { NewcomersModule } from './newcomers/newcomers.module';
import { PeopleImportModule } from './people-import/people-import.module';
import { PrismaModule } from './prisma/prisma.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { AppResolver } from './app.resolver';

const HTTP_STATUS_TO_GRAPHQL_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
};

/** Maps Nest HttpExceptions thrown in guards/resolvers to standard GraphQL error codes. */
function formatGraphQLError(
  formattedError: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const original = unwrapResolverError(error);
  if (original instanceof HttpException) {
    const code = HTTP_STATUS_TO_GRAPHQL_CODE[original.getStatus()];
    if (code) {
      return { ...formattedError, extensions: { ...formattedError.extensions, code } };
    }
  }
  return formattedError;
}

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ThrottlerModule.forRoot({
      // Applied selectively via @UseGuards(ThrottlerGuard) on the auth endpoints.
      throttlers: [{ ttl: 15 * 60 * 1000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: () => ({
        // En dev se escribe el SDL a src/graphql/schema.gql (versionado en el repo).
        // En producción se genera en memoria: el contenedor no lleva src/ y su
        // filesystem es efímero, así que escribirlo fallaría y no serviría de nada.
        autoSchemaFile:
          process.env.NODE_ENV === 'production'
            ? true
            : join(process.cwd(), 'src/graphql/schema.gql'),
        sortSchema: true,
        playground: false,
        introspection: process.env.NODE_ENV !== 'production',
        path: '/graphql',
        context: ({ req, res }: { req: Request; res: Response }) => ({ req, res }),
        formatError: formatGraphQLError,
      }),
    }),
    AuthModule,
    AccessRequestsModule,
    UsersModule,
    MinistriesModule,
    NewcomersModule,
    PeopleImportModule,
    GroupsModule,
    GroupSessionsModule,
    CoursesModule,
    MembershipModule,
    EventsModule,
    FeedModule,
    UploadsModule,
  ],
  providers: [AppResolver],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Registered here (not in main.ts) so e2e tests get cookie parsing too.
    consumer.apply(cookieParser()).forRoutes('*');
  }
}
