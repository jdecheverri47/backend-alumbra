import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { AccessRequestsService } from './access-requests.service';
import {
  AccessRequestModel,
  AccessRequestStatus,
  toAccessRequestModel,
} from './dto/access-request.model';

// Pastores, coordinadores de Acogida (por su cargo) o quien tenga el permiso.
const APPROVE = 'accesos.aprobar';

@Resolver(() => AccessRequestModel)
export class AccessRequestsResolver {
  constructor(private readonly service: AccessRequestsService) {}

  @RequirePermission(APPROVE)
  @Query(() => [AccessRequestModel], {
    description: 'Solicitudes de acceso hechas con Google. Pastores y líderes de Acogida.',
  })
  async accessRequests(
    @Args('status', { type: () => AccessRequestStatus, defaultValue: 'PENDING' })
    status: AccessRequestStatus,
  ): Promise<AccessRequestModel[]> {
    const rows = await this.service.list(status);
    return rows.map(toAccessRequestModel);
  }

  @RequirePermission(APPROVE)
  @Mutation(() => AccessRequestModel, {
    description: 'Da acceso: habilita o crea el usuario (como asistente).',
  })
  async approveAccessRequest(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<AccessRequestModel> {
    return toAccessRequestModel(await this.service.approve(id, me.sub));
  }

  @RequirePermission(APPROVE)
  @Mutation(() => AccessRequestModel)
  async rejectAccessRequest(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<AccessRequestModel> {
    return toAccessRequestModel(await this.service.reject(id, me.sub));
  }
}
