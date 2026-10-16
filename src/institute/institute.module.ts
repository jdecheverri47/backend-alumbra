import { Module } from '@nestjs/common';
import { InstituteResolver } from './institute.resolver';
import { InstituteService } from './institute.service';

@Module({ providers: [InstituteResolver, InstituteService] })
export class InstituteModule {}
