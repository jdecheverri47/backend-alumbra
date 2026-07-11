import { Module } from '@nestjs/common';
import { FeedResolver } from './feed.resolver';
import { FeedService } from './feed.service';

@Module({
  providers: [FeedService, FeedResolver],
  exports: [FeedService],
})
export class FeedModule {}
