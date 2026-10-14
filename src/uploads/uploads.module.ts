import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { UPLOAD_DIR, UploadsController } from './uploads.controller';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: UPLOAD_DIR,
      serveRoot: '/uploads',
      serveStaticOptions: { index: false, fallthrough: false },
    }),
  ],
  controllers: [UploadsController],
})
export class UploadsModule {}
