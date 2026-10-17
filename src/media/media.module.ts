import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { VideoProcessingService } from './video-processing.service';

@Module({
  imports: [UploadsModule],
  providers: [VideoProcessingService],
  exports: [VideoProcessingService],
})
export class MediaModule {}
