import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccessRequestsModule } from '../access-requests/access-requests.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleTokenVerifier } from './google-token.verifier';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MinistryLeaderGuard } from './guards/ministry-leader.guard';
import { PastorGuard } from './guards/pastor.guard';

@Module({
  imports: [
    AccessRequestsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleTokenVerifier,
    // Order matters: authenticate first, then role checks.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PastorGuard },
    { provide: APP_GUARD, useClass: MinistryLeaderGuard },
  ],
})
export class AuthModule {}
