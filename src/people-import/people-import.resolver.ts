import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PermissionsService } from '../permissions/permissions.service';
import { ImportPeopleResult, ImportPersonInput } from './dto/import.types';
import { PeopleImportService } from './people-import.service';

@Resolver()
export class PeopleImportResolver {
  constructor(
    private readonly service: PeopleImportService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Importar una hoja exige "Importar personas"; agregar a una sola persona
   * (el botón "Agregar persona") basta con "Agregar personas". Asignar
   * ministerios desde la hoja es nombrar coordinadores: exige además
   * "Administrar ministerios".
   */
  @Mutation(() => ImportPeopleResult, {
    description:
      'Carga personas desde una hoja. Con apply: false solo devuelve la vista previa; con true, guarda.',
  })
  async importPeople(
    @Args('rows', { type: () => [ImportPersonInput] }) rows: ImportPersonInput[],
    @Args('apply', { defaultValue: false }) apply: boolean,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<ImportPeopleResult> {
    if (rows.length !== 1 || !(await this.permissions.can(me, 'personas.crear'))) {
      await this.permissions.assert(me, 'personas.importar');
    }
    const canAssignMinistries = await this.permissions.can(me, 'ministerios.administrar');
    return this.service.run(rows, apply, { canAssignMinistries });
  }
}
