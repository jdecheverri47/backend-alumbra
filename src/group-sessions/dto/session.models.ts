import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { GroupModel } from '../../groups/dto/group.model';
import { UserModel } from '../../users/dto/user.model';
import { GroupSessionStatus } from './session-status.enum';

@ObjectType('SessionMaterial')
export class SessionMaterialModel {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field()
  url!: string;

  @Field(() => UserModel)
  uploadedBy!: UserModel;

  @Field(() => Date)
  createdAt!: Date;
}

@ObjectType('AssignmentSubmission')
export class SubmissionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  user!: UserModel;

  @Field()
  url!: string;

  @Field(() => Date)
  submittedAt!: Date;
}

@ObjectType('SessionAssignment')
export class SessionAssignmentModel {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Date, { nullable: true })
  dueAt?: Date | null;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => [SubmissionModel], {
    description: 'Líder/pastor: todas las entregas. Miembro: solo la propia.',
  })
  submissions!: SubmissionModel[];

  @Field(() => SubmissionModel, { nullable: true })
  mySubmission?: SubmissionModel | null;
}

@ObjectType('SessionAttendance')
export class AttendanceModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  user!: UserModel;

  @Field(() => Date, { description: 'Hora de ingreso a la clase.' })
  checkedInAt!: Date;
}

@ObjectType('SessionLessonTopic')
export class SessionLessonTopicModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  order!: number;

  @Field()
  title!: string;
}

@ObjectType('SessionLesson', { description: 'Clase del currículo que implementa esta sesión.' })
export class SessionLessonModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  order!: number;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => SessionLessonTopicModel)
  topic!: SessionLessonTopicModel;
}

@ObjectType('GroupSession')
export class GroupSessionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => GroupModel)
  group!: GroupModel;

  @Field(() => Date, { description: 'Fecha canónica de la reunión de esa semana.' })
  scheduledFor!: Date;

  @Field(() => Date, { description: 'Fecha/hora efectiva (difiere si fue reprogramada).' })
  startsAt!: Date;

  @Field(() => GroupSessionStatus)
  status!: GroupSessionStatus;

  @Field(() => String, { nullable: true, description: 'Tema de la clase.' })
  title?: string | null;

  @Field(() => String, { nullable: true, description: 'Nota de reprogramación/cancelación.' })
  note?: string | null;

  @Field(() => SessionLessonModel, { nullable: true })
  lesson?: SessionLessonModel | null;

  @Field(() => [SessionMaterialModel])
  materials!: SessionMaterialModel[];

  @Field(() => [SessionAssignmentModel])
  assignments!: SessionAssignmentModel[];

  @Field(() => [AttendanceModel], {
    description: 'Líder/pastor: toda la asistencia con horas. Miembro: solo la propia.',
  })
  attendances!: AttendanceModel[];
}
