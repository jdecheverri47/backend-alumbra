import { Field, ID, ObjectType } from '@nestjs/graphql';
import { GroupModel } from '../../groups/dto/group.model';
import { UserModel } from '../../users/dto/user.model';
import { JourneyStage } from './journey-stage.enum';

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
