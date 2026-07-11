import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { CoursesResolver } from './courses.resolver';
import { CoursesService } from './courses.service';

@Module({
  imports: [GroupsModule],
  providers: [CoursesService, CoursesResolver],
  exports: [CoursesService],
})
export class CoursesModule {}
