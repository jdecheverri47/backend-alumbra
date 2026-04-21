import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => validateEnv(raw),
      cache: true,
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
