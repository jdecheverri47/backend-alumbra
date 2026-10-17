import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { InstituteResolver } from './institute.resolver';
import { InstituteService } from './institute.service';

@Module({ imports: [MediaModule], providers: [InstituteResolver, InstituteService] })
export class InstituteModule {}
