import { Field, Float, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { UserModel } from '../../users/dto/user.model';
import {
  InstituteAttachmentKind,
  InstituteItemKind,
  InstituteItemStatus,
  InstituteRole,
  InstituteSubmissionState,
} from './institute-enums';

@ObjectType('InstituteAccess')
export class InstituteAccessModel {
  @Field(() => InstituteRole, { nullable: true, description: 'null si no está inscrito.' })
  role?: InstituteRole | null;

  @Field({ description: 'Profesor o pastor: administra el instituto.' })
  canManage!: boolean;

  @Field({ description: 'Puede entrar (inscrito o pastor).' })
  canView!: boolean;
}

@ObjectType('InstituteAttachment')
export class InstituteAttachmentModel {
  @Field(() => ID)
  id!: string;

  @Field(() => InstituteAttachmentKind)
  kind!: InstituteAttachmentKind;

  @Field()
  title!: string;

  @Field()
  url!: string;

  @Field(() => String, { nullable: true })
  mimeType?: string | null;
}

@ObjectType('InstituteMySubmission')
export class InstituteMySubmissionModel {
  @Field(() => InstituteSubmissionState, { nullable: true })
  state?: InstituteSubmissionState | null;

  @Field(() => Date, { nullable: true })
  turnedInAt?: Date | null;

  @Field()
  late!: boolean;

  @Field(() => Float, { nullable: true, description: 'Solo la nota devuelta.' })
  grade?: number | null;
}

@ObjectType('InstituteItem')
export class InstituteItemModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  moduleId!: string;

  @Field(() => InstituteItemKind)
  kind!: InstituteItemKind;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Int, { nullable: true })
  maxPoints?: number | null;

  @Field(() => Date, { nullable: true })
  dueAt?: Date | null;

  @Field(() => Date, { nullable: true })
  publishAt?: Date | null;

  @Field(() => InstituteItemStatus)
  status!: InstituteItemStatus;

  @Field(() => UserModel)
  author!: UserModel;

  @Field(() => [InstituteAttachmentModel])
  attachments!: InstituteAttachmentModel[];

  @Field(() => InstituteMySubmissionModel, {
    nullable: true,
    description: 'La entrega de quien consulta (alumnos).',
  })
  mySubmission?: InstituteMySubmissionModel | null;

  @Field(() => Int, { nullable: true, description: 'Entregadas o calificadas (profesores).' })
  turnedInCount?: number | null;

  @Field(() => Date)
  createdAt!: Date;
}

@ObjectType('InstituteModule')
export class InstituteModuleModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  order!: number;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => [InstituteItemModel])
  items!: InstituteItemModel[];
}

@ObjectType('InstituteSubmission')
export class InstituteSubmissionModel {
  @Field(() => UserModel)
  student!: UserModel;

  @Field(() => InstituteSubmissionState, { nullable: true })
  state?: InstituteSubmissionState | null;

  @Field(() => Date, { nullable: true })
  turnedInAt?: Date | null;

  @Field()
  late!: boolean;

  @Field(() => Float, { nullable: true })
  grade?: number | null;

  @Field(() => Float, { nullable: true, description: 'Nota sin devolver: solo profesores.' })
  draftGrade?: number | null;
}

@ObjectType('InstituteEnrollment')
export class InstituteEnrollmentModel {
  @Field(() => ID)
  id!: string;

  @Field(() => InstituteRole)
  role!: InstituteRole;

  @Field(() => UserModel)
  user!: UserModel;

  @Field(() => Date)
  createdAt!: Date;
}

@ObjectType('InstituteGradeCell')
export class InstituteGradeCellModel {
  @Field(() => ID)
  itemId!: string;

  @Field(() => InstituteSubmissionState, { nullable: true })
  state?: InstituteSubmissionState | null;

  @Field(() => Float, { nullable: true })
  grade?: number | null;

  @Field(() => Float, { nullable: true })
  draftGrade?: number | null;

  @Field()
  late!: boolean;
}

@ObjectType('InstituteGradebookRow')
export class InstituteGradebookRowModel {
  @Field(() => UserModel)
  student!: UserModel;

  @Field(() => [InstituteGradeCellModel], { description: 'Solo las tareas con algo guardado.' })
  cells!: InstituteGradeCellModel[];
}

@ObjectType('InstituteGradebook')
export class InstituteGradebookModel {
  @Field(() => [InstituteItemModel], { description: 'Tareas y exámenes, en orden de módulo.' })
  items!: InstituteItemModel[];

  @Field(() => [InstituteGradebookRowModel])
  rows!: InstituteGradebookRowModel[];
}

@ObjectType('InstituteClass')
export class InstituteClassModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  moduleId!: string;

  @Field()
  moduleTitle!: string;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Date)
  startsAt!: Date;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;

  @Field(() => String, { nullable: true })
  location?: string | null;

  @Field(() => String, { nullable: true })
  meetingUrl?: string | null;
}

export enum InstituteCalendarEntryType {
  CLASS = 'CLASS',
  DEADLINE = 'DEADLINE',
}
registerEnumType(InstituteCalendarEntryType, { name: 'InstituteCalendarEntryType' });

@ObjectType('InstituteCalendarEntry')
export class InstituteCalendarEntryModel {
  @Field(() => ID, { description: 'Id de la clase o de la tarea.' })
  id!: string;

  @Field(() => InstituteCalendarEntryType)
  type!: InstituteCalendarEntryType;

  @Field()
  title!: string;

  @Field(() => Date, { description: 'Inicio de la clase o fecha límite de la entrega.' })
  startsAt!: Date;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;

  @Field()
  moduleTitle!: string;

  @Field(() => InstituteItemKind, { nullable: true })
  itemKind?: InstituteItemKind | null;

  @Field(() => String, { nullable: true })
  location?: string | null;

  @Field(() => String, { nullable: true })
  meetingUrl?: string | null;

  @Field({ description: 'Alumnos: ya la entregó o tiene nota.' })
  done!: boolean;
}

@ObjectType('FormGradesImport')
export class FormGradesImportModel {
  @Field(() => Int, { description: 'Respuestas distintas (una por correo).' })
  responses!: number;

  @Field(() => Int, { description: 'Coinciden con un alumno inscrito.' })
  matched!: number;

  @Field(() => Int, { description: 'Se guardan (o se guardarían) ahora.' })
  updated!: number;

  @Field(() => Int, { description: 'Ya tenían nota devuelta y no se tocan.' })
  skippedReturned!: number;

  @Field(() => [String], { description: 'Correos que no son de alumnos del instituto.' })
  unmatched!: string[];

  @Field(() => Int, { description: 'Alumnos inscritos que no respondieron.' })
  missing!: number;

  @Field(() => Float, { nullable: true, description: 'Puntos de la tarea a los que se convierte.' })
  maxPoints?: number | null;

  @Field()
  applied!: boolean;
}
