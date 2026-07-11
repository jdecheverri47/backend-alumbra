import { Module } from '@nestjs/common';
import { GroupSessionsResolver } from './group-sessions.resolver';
import { GroupSessionsService } from './group-sessions.service';

@Module({
  providers: [GroupSessionsService, GroupSessionsResolver],
  exports: [GroupSessionsService],
})
export class GroupSessionsModule {}
