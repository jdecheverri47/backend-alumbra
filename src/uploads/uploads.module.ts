import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiskUploadStorage, GcsUploadStorage, UploadStorage } from './upload-storage';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [UploadsController],
  providers: [
    {
      // Con GCS_BUCKET los archivos van al bucket; sin él, a la carpeta local.
      // El disco de Cloud Run se borra en cada despliegue: en producción
      // siempre tiene que ir el bucket.
      provide: UploadStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService): UploadStorage => {
        const bucket = config.get<string>('GCS_BUCKET');
        if (bucket) {
          Logger.log(`Archivos en gs://${bucket}`, 'Uploads');
          return new GcsUploadStorage(bucket);
        }
        return new DiskUploadStorage(config.getOrThrow<string>('JWT_SECRET'));
      },
    },
  ],
})
export class UploadsModule {}
