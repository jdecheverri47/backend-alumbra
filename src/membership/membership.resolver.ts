import { Args, Field, ID, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePastor } from '../auth/decorators/require-pastor.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { JourneyStage } from './dto/journey-stage.enum';
import {
  ChurchFilterInfoModel,
  ChurchObservationModel,
  MembershipJourneyModel,
} from './dto/membership.models';
import { MembershipService } from './membership.service';

@InputType()
export class StartJourneyInput {
  @Field(() => ID)
  userId!: string;

  @Field(() => ID, { nullable: true, description: 'Default: quien registra.' })
  interviewerId?: string;

  @Field(() => Date, { nullable: true, description: 'Default: ahora.' })
  preInterviewAt?: Date;

  @Field(() => String, { nullable: true })
  preInterviewNotes?: string;
}

@InputType()
export class SubmitFinalWorkInput {
  @Field({ description: 'Ensayo (~2000 palabras), archivo subido a /uploads.' })
  essayUrl!: string;

  @Field({ description: 'Testimonio en texto.' })
  testimony!: string;

  @Field({ description: 'Imagen, subida a /uploads.' })
  imageUrl!: string;
}

@Resolver(() => MembershipJourneyModel)
export class MembershipResolver {
  constructor(private readonly membershipService: MembershipService) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  @Query(() => MembershipJourneyModel, { nullable: true, description: 'Mi proceso de membresía.' })
  async myJourney(@CurrentUser() me: AuthenticatedUser): Promise<MembershipJourneyModel | null> {
    return this.membershipService.myJourney(me);
  }

  @RequirePastor()
  @Query(() => [MembershipJourneyModel], { description: 'Tablero de candidatos (pastores).' })
  async membershipJourneys(
    @Args('stage', { type: () => JourneyStage, nullable: true }) stage?: JourneyStage,
  ): Promise<MembershipJourneyModel[]> {
    return this.membershipService.list(stage);
  }

  @Query(() => [MembershipJourneyModel], { description: 'Procesos donde soy el entrevistador.' })
  async myInterviews(@CurrentUser() me: AuthenticatedUser): Promise<MembershipJourneyModel[]> {
    return this.membershipService.myInterviews(me);
  }

  @Query(() => [MembershipJourneyModel], {
    description: 'Candidatos asignados a mí como líder de ruta, pendientes de cohorte.',
  })
  async myAssignedCandidates(
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MembershipJourneyModel[]> {
    return this.membershipService.myAssignedCandidates(me);
  }

  @Query(() => MembershipJourneyModel, {
    nullable: true,
    description: 'Proceso de una persona (pastor, entrevistador o la propia persona).',
  })
  async membershipJourneyOf(
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MembershipJourneyModel | null> {
    return this.membershipService.journeyOf(me, userId);
  }

  @Query(() => ChurchFilterInfoModel, {
    nullable: true,
    description: 'Filtro de iglesia abierto para un candidato (para miembros).',
  })
  async churchFilterFor(
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<ChurchFilterInfoModel | null> {
    return this.membershipService.churchFilterFor(me, userId);
  }

  @RequirePastor()
  @Query(() => [ChurchObservationModel], { description: 'Observaciones del filtro (pastores).' })
  async journeyObservations(
    @Args('journeyId', { type: () => ID }) journeyId: string,
  ): Promise<ChurchObservationModel[]> {
    return this.membershipService.observations(journeyId);
  }

  // ── Transiciones ───────────────────────────────────────────────────────────

  // Pastor o líder de ministerio (validado en el service).
  @Mutation(() => MembershipJourneyModel, { description: 'Registra la pre-entrevista.' })
  async startMembershipJourney(
    @Args('input') input: StartJourneyInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.start(me, input);
  }

  // Entrevistador o pastor (validado en el service).
  @Mutation(() => MembershipJourneyModel, {
    description: 'Valida (o no) la entrada a la Ruta. Exige Evangelio certificado.',
  })
  async validateJourney(
    @Args('id', { type: () => ID }) id: string,
    @Args('approved') approved: boolean,
    @CurrentUser() me: AuthenticatedUser,
    @Args('notes', { nullable: true }) notes?: string,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.validate(me, id, approved, notes);
  }

  // Entrevistador o pastor (validado en el service).
  @Mutation(() => MembershipJourneyModel, { description: 'Agenda o reprograma la entrevista.' })
  async scheduleJourneyInterview(
    @Args('id', { type: () => ID }) id: string,
    @Args('at', { type: () => Date }) at: Date,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.scheduleInterview(me, id, at);
  }

  // Entrevistador o pastor (validado en el service).
  @Mutation(() => MembershipJourneyModel, {
    description: 'Aplaza al candidato a una próxima ruta.',
  })
  async deferJourney(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
    @Args('notes', { nullable: true }) notes?: string,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.defer(me, id, notes);
  }

  // Entrevistador o pastor (validado en el service).
  @Mutation(() => MembershipJourneyModel, {
    description: 'Asigna el candidato a un líder de ruta; el líder decide la cohorte.',
  })
  async assignJourneyToLeader(
    @Args('id', { type: () => ID }) id: string,
    @Args('leaderId', { type: () => ID }) leaderId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.assignToLeader(me, id, leaderId);
  }

  // Entrevistador, pastor o líder asignado hacia su cohorte (validado en el service).
  @Mutation(() => MembershipJourneyModel, { description: 'Asigna a una cohorte de la Ruta.' })
  async assignJourneyToRuta(
    @Args('id', { type: () => ID }) id: string,
    @Args('groupId', { type: () => ID }) groupId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.assignToRuta(me, id, groupId);
  }

  // Líder de la cohorte o pastor (validado en el service).
  @Mutation(() => MembershipJourneyModel, { description: 'Marca la Ruta como terminada.' })
  async completeRuta(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.completeRuta(me, id);
  }

  @Mutation(() => MembershipJourneyModel, {
    description: 'El candidato entrega ensayo, testimonio e imagen.',
  })
  async submitFinalWork(
    @Args('input') input: SubmitFinalWorkInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.submitFinalWork(me, input);
  }

  @RequirePastor()
  @Mutation(() => MembershipJourneyModel, {
    description: 'Abre el filtro de iglesia y publica el anuncio.',
  })
  async openChurchFilter(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.openChurchFilter(me, id);
  }

  // Miembros (validado en el service).
  @Mutation(() => Boolean, { description: 'Deja (o actualiza) mi observación sobre el candidato.' })
  async addChurchObservation(
    @Args('journeyId', { type: () => ID }) journeyId: string,
    @Args('body') body: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<boolean> {
    return this.membershipService.addObservation(me, { journeyId, body });
  }

  @RequirePastor()
  @Mutation(() => MembershipJourneyModel)
  async closeChurchFilter(
    @Args('id', { type: () => ID }) id: string,
    @Args('passed') passed: boolean,
    @Args('pastoralInterviewAt', { type: () => Date, nullable: true })
    pastoralInterviewAt?: Date,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.closeChurchFilter(id, passed, pastoralInterviewAt);
  }

  @RequirePastor()
  @Mutation(() => MembershipJourneyModel, {
    description: 'Firma del pacto: la persona pasa a ser MIEMBRO.',
  })
  async signCovenant(
    @Args('id', { type: () => ID }) id: string,
    @Args('date', { type: () => Date, nullable: true }) date?: Date,
  ): Promise<MembershipJourneyModel> {
    return this.membershipService.signCovenant(id, date);
  }
}
