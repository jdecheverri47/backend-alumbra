import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module';
import { MembershipResolver } from './membership.resolver';
import { MembershipService } from './membership.service';

@Module({
  imports: [CoursesModule],
  providers: [MembershipService, MembershipResolver],
  exports: [MembershipService],
})
export class MembershipModule {}
