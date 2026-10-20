import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { InstituteRequestsResolver } from './institute-requests.resolver';
import { InstituteRequestsService } from './institute-requests.service';
import { InstituteResolver } from './institute.resolver';
import { InstituteService } from './institute.service';

@Module({
  imports: [MediaModule],
  providers: [
    InstituteResolver,
    InstituteService,
    InstituteRequestsResolver,
    InstituteRequestsService,
  ],
})
export class InstituteModule {}
