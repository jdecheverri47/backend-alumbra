import { Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import { InstituteAttachmentKind, InstituteItemKind, InstituteRole } from './institute-enums';

@InputType()
export class InstituteModuleInput {
  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;
}

@InputType()
export class InstituteAttachmentInput {
  @Field(() => InstituteAttachmentKind)
  kind!: InstituteAttachmentKind;

  @Field()
  title!: string;

  @Field({ description: '/uploads/... o URL http(s).' })
  url!: string;

  @Field(() => String, { nullable: true })
  mimeType?: string | null;
}

@InputType()
export class InstituteItemInput {
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

  @Field(() => Date, {
    nullable: true,
    description: 'Cuándo la ven los alumnos. null = borrador; ahora o antes = publicada.',
  })
  publishAt?: Date | null;

  @Field(() => [InstituteAttachmentInput], { defaultValue: [] })
  attachments!: InstituteAttachmentInput[];
}

@InputType()
export class InstituteGradeInput {
  @Field(() => ID)
  itemId!: string;

  @Field(() => ID)
  studentId!: string;

  @Field(() => Float, { nullable: true, description: 'null borra la nota.' })
  grade?: number | null;

  @Field({ description: 'true = el alumno la ve; false = queda como borrador.' })
  returnToStudent!: boolean;
}

@InputType()
export class InstituteEnrollInput {
  @Field(() => [ID])
  userIds!: string[];

  @Field(() => InstituteRole, { defaultValue: 'STUDENT' })
  role!: InstituteRole;
}

@InputType()
export class InstituteClassInput {
  @Field(() => ID)
  moduleId!: string;

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

  @Field(() => String, { nullable: true, description: 'Enlace para conectarse (YouTube, Meet…).' })
  meetingUrl?: string | null;
}

@InputType()
export class FormResponseInput {
  @Field({ description: 'Correo con el que respondió.' })
  email!: string;

  @Field(() => Float)
  score!: number;

  @Field(() => Date, { nullable: true })
  submittedAt?: Date | null;
}

@InputType()
export class ImportFormGradesInput {
  @Field(() => ID)
  itemId!: string;

  @Field(() => [FormResponseInput])
  responses!: FormResponseInput[];

  @Field(() => Float, {
    description: 'Puntaje máximo del formulario (para convertir a los de la tarea).',
  })
  formTotal!: number;

  @Field({ defaultValue: false, description: 'true = el alumno ve la nota; false = borrador.' })
  returnToStudent!: boolean;

  @Field({ defaultValue: false, description: 'Reemplazar notas ya devueltas.' })
  overwriteReturned!: boolean;

  @Field({ defaultValue: false, description: 'false = solo vista previa.' })
  apply!: boolean;
}
