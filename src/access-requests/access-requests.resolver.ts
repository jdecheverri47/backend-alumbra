import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireMinistryLeader } from '../auth/decorators/require-ministry-leader.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AccessRequestsService } from './access-requests.service';
import {
  AccessRequestModel,
  AccessRequestStatus,
  toAccessRequestModel,
} from './dto/access-request.model';

// Las mismas personas que registran a los recién llegados (createUser):
// pastores y líderes de Acogida.
const ACOGIDA = () => ({ ministrySlug: 'acogida' });

@Resolver(() => AccessRequestModel)
export class AccessRequestsResolver {
  constructor(private readonly service: AccessRequestsService) {}

  @RequireMinistryLeader(ACOGIDA)
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

  @RequireMinistryLeader(ACOGIDA)
  @Mutation(() => AccessRequestModel, {
    description: 'Da acceso: habilita o crea el usuario (como asistente).',
  })
  async approveAccessRequest(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<AccessRequestModel> {
    return toAccessRequestModel(await this.service.approve(id, me.sub));
  }

  @RequireMinistryLeader(ACOGIDA)
  @Mutation(() => AccessRequestModel)
  async rejectAccessRequest(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<AccessRequestModel> {
    return toAccessRequestModel(await this.service.reject(id, me.sub));
  }
}
