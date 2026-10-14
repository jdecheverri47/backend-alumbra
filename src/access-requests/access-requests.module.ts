import { Module } from '@nestjs/common';
import { AccessRequestsResolver } from './access-requests.resolver';
import { AccessRequestsService } from './access-requests.service';

@Module({
  providers: [AccessRequestsService, AccessRequestsResolver],
  exports: [AccessRequestsService],
})
export class AccessRequestsModule {}
