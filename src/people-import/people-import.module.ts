import { Module } from '@nestjs/common';
import { PeopleImportResolver } from './people-import.resolver';
import { PeopleImportService } from './people-import.service';

@Module({ providers: [PeopleImportResolver, PeopleImportService] })
export class PeopleImportModule {}
