import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { RequirePastor } from '../auth/decorators/require-pastor.decorator';
import { ImportPeopleResult, ImportPersonInput } from './dto/import.types';
import { PeopleImportService } from './people-import.service';

@Resolver()
export class PeopleImportResolver {
  constructor(private readonly service: PeopleImportService) {}

  @RequirePastor()
  @Mutation(() => ImportPeopleResult, {
    description:
      'Carga personas desde una hoja. Con apply: false solo devuelve la vista previa; con true, guarda.',
  })
  async importPeople(
    @Args('rows', { type: () => [ImportPersonInput] }) rows: ImportPersonInput[],
    @Args('apply', { defaultValue: false }) apply: boolean,
  ): Promise<ImportPeopleResult> {
    return this.service.run(rows, apply);
  }
}
