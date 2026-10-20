import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import {
  InstituteRequestModel,
  InstituteRequestStatus,
  MyInstituteRequestModel,
} from './dto/institute-request.models';
import { InstituteRequestsService } from './institute-requests.service';

/** Pedir entrar al Instituto y decidir esas solicitudes. Permisos en el servicio. */
@Resolver(() => InstituteRequestModel)
export class InstituteRequestsResolver {
  constructor(private readonly service: InstituteRequestsService) {}

  @Query(() => MyInstituteRequestModel, { description: 'Mi última solicitud y si puedo pedir.' })
  myInstituteRequest(@CurrentUser() me: AuthenticatedUser): Promise<MyInstituteRequestModel> {
    return this.service.mine(me);
  }

  @Query(() => [InstituteRequestModel], { description: 'Requiere "Aprobar inscripciones".' })
  instituteRequests(
    @CurrentUser() me: AuthenticatedUser,
    @Args('status', { type: () => InstituteRequestStatus, defaultValue: 'PENDING' })
    status: InstituteRequestStatus,
  ): Promise<InstituteRequestModel[]> {
    return this.service.list(me, status);
  }

  @Mutation(() => InstituteRequestModel)
  requestInstituteEnrollment(
    @CurrentUser() me: AuthenticatedUser,
    @Args('note', { type: () => String, nullable: true }) note?: string | null,
  ): Promise<InstituteRequestModel> {
    return this.service.request(me, note);
  }

  @Mutation(() => Boolean, { description: 'Cancela mi solicitud pendiente.' })
  cancelInstituteRequest(@CurrentUser() me: AuthenticatedUser): Promise<boolean> {
    return this.service.cancel(me);
  }

  @Mutation(() => InstituteRequestModel)
  approveInstituteRequest(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<InstituteRequestModel> {
    return this.service.approve(me, id);
  }

  @Mutation(() => InstituteRequestModel)
  rejectInstituteRequest(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('reviewNote', { type: () => String, nullable: true }) reviewNote?: string | null,
  ): Promise<InstituteRequestModel> {
    return this.service.reject(me, id, reviewNote);
  }
}
