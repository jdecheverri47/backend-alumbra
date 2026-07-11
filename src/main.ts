import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.getOrThrow<string>('CORS_ORIGIN'),
    credentials: true,
  });

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
  Logger.log(`Alumbra backend listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
