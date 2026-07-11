import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { GroupSessionStatus } from '../../group-sessions/dto/session-status.enum';
import { GroupModel } from '../../groups/dto/group.model';
import { UserModel } from '../../users/dto/user.model';
import { JourneyStage } from './journey-stage.enum';

@ObjectType('RutaAssignmentTrace')
export class RutaAssignmentTraceModel {
  @Field()
  title!: string;

  @Field(() => Boolean)
  submitted!: boolean;

  @Field(() => Date, { nullable: true })
  submittedAt?: Date | null;

  @Field(() => String, { nullable: true, description: 'Archivo entregado (si existe).' })
  url?: string | null;
}

@ObjectType('RutaClassTrace', {
  description: 'Trazabilidad del candidato en una clase de la Ruta.',
})
export class RutaClassTraceModel {
  @Field(() => ID)
  sessionId!: string;

  @Field(() => Date)
  startsAt!: Date;

  @Field(() => GroupSessionStatus)
  status!: GroupSessionStatus;

  @Field(() => String, { nullable: true })
  title?: string | null;

  @Field(() => String, { nullable: true })
  topicTitle?: string | null;

  @Field(() => Boolean)
  attended!: boolean;

  @Field(() => Date, { nullable: true, description: 'Hora de ingreso registrada.' })
  checkedInAt?: Date | null;

  @Field(() => [RutaAssignmentTraceModel])
  assignments!: RutaAssignmentTraceModel[];
}

@ObjectType('RutaProgress')
export class RutaProgressModel {
  @Field(() => Int, { description: 'Clases no canceladas de la cohorte.' })
  sessionsTotal!: number;

  @Field(() => Int)
  sessionsAttended!: number;

  @Field(() => Int)
  assignmentsTotal!: number;

  @Field(() => Int)
  assignmentsSubmitted!: number;

  @Field(() => [RutaClassTraceModel])
  classes!: RutaClassTraceModel[];
}

@ObjectType('MembershipJourney')
export class MembershipJourneyModel {
  @Field(() => ID)
  id!: string;

  @Field(() => JourneyStage)
  stage!: JourneyStage;

  @Field(() => UserModel)
  user!: UserModel;

  @Field(() => UserModel, { nullable: true })
  interviewer?: UserModel | null;

  @Field(() => Date, { nullable: true })
  preInterviewAt?: Date | null;

  @Field(() => String, {
    nullable: true,
    description: 'Notas de la pre-entrevista (solo pastores/entrevistador).',
  })
  preInterviewNotes?: string | null;

  @Field(() => Date, { nullable: true })
  validatedAt?: Date | null;

  @Field(() => GroupModel, { nullable: true, description: 'Cohorte de la Ruta.' })
  rutaGroup?: GroupModel | null;

  @Field(() => RutaProgressModel, {
    nullable: true,
    description: 'Avance del candidato en su cohorte (asistencia y tareas por clase).',
  })
  rutaProgress?: RutaProgressModel | null;

  @Field(() => Date, { nullable: true })
  rutaCompletedAt?: Date | null;

  @Field(() => String, { nullable: true })
  essayUrl?: string | null;

  @Field(() => String, { nullable: true })
  testimony?: string | null;

  @Field(() => String, { nullable: true })
  imageUrl?: string | null;

  @Field(() => Date, { nullable: true })
  finalSubmittedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  churchFilterOpenedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  churchFilterClosedAt?: Date | null;

  @Field(() => Boolean, { nullable: true })
  churchFilterPassed?: boolean | null;

  @Field(() => Date, { nullable: true })
  pastoralInterviewAt?: Date | null;

  @Field(() => Date, { nullable: true })
  covenantSignedAt?: Date | null;

  @Field(() => String, {
    nullable: true,
    description: 'Notas internas pastorales (solo pastores/entrevistador).',
  })
  notes?: string | null;

  @Field(() => Date)
  createdAt!: Date;
}

@ObjectType('ChurchObservation')
export class ChurchObservationModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  author!: UserModel;

  @Field()
  body!: string;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

@ObjectType('ChurchFilterInfo', {
  description: 'Filtro de iglesia abierto para un candidato, visto por un miembro.',
})
export class ChurchFilterInfoModel {
  @Field(() => ID)
  journeyId!: string;

  @Field(() => UserModel)
  candidate!: UserModel;

  @Field(() => Date)
  openedAt!: Date;

  @Field(() => String, { nullable: true, description: 'Mi observación ya enviada, si existe.' })
  myObservation?: string | null;
}
