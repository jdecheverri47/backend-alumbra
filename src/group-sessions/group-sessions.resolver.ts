import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import {
  AddSessionMaterialInput,
  CreateGroupSessionInput,
  CreateSessionAssignmentInput,
} from './dto/create-session.input';
import {
  AttendanceModel,
  GroupSessionModel,
  SessionAssignmentModel,
  SessionMaterialModel,
  SubmissionModel,
} from './dto/session.models';
import { GroupSessionsService } from './group-sessions.service';

// Autorización por rol validada en el service (líder del grupo o pastor para gestión;
// miembro activo para consultar y entregar trabajos).
@Resolver(() => GroupSessionModel)
export class GroupSessionsResolver {
  constructor(private readonly sessionsService: GroupSessionsService) {}

  @Query(() => [GroupSessionModel], { description: 'Clases de un grupo, más reciente primero.' })
  async groupSessions(
    @Args('groupId', { type: () => ID }) groupId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupSessionModel[]> {
    return this.sessionsService.listByGroup(me, groupId);
  }

  @Query(() => GroupSessionModel)
  async groupSession(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupSessionModel> {
    return this.sessionsService.findForViewer(me, id);
  }

  @Query(() => [GroupSessionModel], {
    description: 'Clases de mis grupos que tocan el rango (para el calendario).',
  })
  async groupSessionsInRange(
    @Args('from', { type: () => Date }) from: Date,
    @Args('to', { type: () => Date }) to: Date,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupSessionModel[]> {
    return this.sessionsService.listInRange(me, from, to);
  }

  @Mutation(() => GroupSessionModel)
  async createGroupSession(
    @Args('input') input: CreateGroupSessionInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupSessionModel> {
    return this.sessionsService.create(me, input);
  }

  @Mutation(() => GroupSessionModel, { description: 'Reprogramar (reactiva si estaba cancelada).' })
  async rescheduleGroupSession(
    @Args('id', { type: () => ID }) id: string,
    @Args('startsAt', { type: () => Date }) startsAt: Date,
    @CurrentUser() me: AuthenticatedUser,
    @Args('note', { nullable: true }) note?: string,
  ): Promise<GroupSessionModel> {
    return this.sessionsService.reschedule(me, id, { startsAt, note });
  }

  @Mutation(() => GroupSessionModel, { description: 'Marca la clase como dictada.' })
  async completeGroupSession(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupSessionModel> {
    return this.sessionsService.complete(me, id);
  }

  @Mutation(() => GroupSessionModel)
  async cancelGroupSession(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
    @Args('note', { nullable: true }) note?: string,
  ): Promise<GroupSessionModel> {
    return this.sessionsService.cancel(me, id, note);
  }

  @Mutation(() => AttendanceModel, {
    description: 'Registra el ingreso de un miembro a la clase (guarda la hora).',
  })
  async checkInToSession(
    @Args('sessionId', { type: () => ID }) sessionId: string,
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<AttendanceModel> {
    return this.sessionsService.checkIn(me, sessionId, userId);
  }

  @Mutation(() => Boolean)
  async undoCheckIn(
    @Args('sessionId', { type: () => ID }) sessionId: string,
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<boolean> {
    return this.sessionsService.undoCheckIn(me, sessionId, userId);
  }

  @Mutation(() => SessionMaterialModel)
  async addSessionMaterial(
    @Args('input') input: AddSessionMaterialInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<SessionMaterialModel> {
    return this.sessionsService.addMaterial(me, input);
  }

  @Mutation(() => Boolean)
  async removeSessionMaterial(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<boolean> {
    return this.sessionsService.removeMaterial(me, id);
  }

  @Mutation(() => SessionAssignmentModel)
  async createSessionAssignment(
    @Args('input') input: CreateSessionAssignmentInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<SessionAssignmentModel> {
    return this.sessionsService.createAssignment(me, input);
  }

  @Mutation(() => SubmissionModel, { description: 'Sube (o reemplaza) mi trabajo de la clase.' })
  async submitAssignment(
    @Args('assignmentId', { type: () => ID }) assignmentId: string,
    @Args('url') url: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<SubmissionModel> {
    return this.sessionsService.submitAssignment(me, { assignmentId, url });
  }
}
