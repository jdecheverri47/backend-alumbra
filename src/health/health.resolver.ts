import { Query, Resolver } from '@nestjs/graphql';
import { PrismaService } from '../prisma/prisma.service';

@Resolver()
export class HealthResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query(() => String, { description: 'Health check: returns "pong" if DB is reachable.' })
  async ping(): Promise<string> {
    await this.prisma.$queryRaw`SELECT 1`;
    return 'pong';
  }
}
