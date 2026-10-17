import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { FeedResolver } from './feed.resolver';
import { FeedService } from './feed.service';

@Module({
  imports: [MediaModule],
  providers: [FeedService, FeedResolver],
  exports: [FeedService],
})
export class FeedModule {}
