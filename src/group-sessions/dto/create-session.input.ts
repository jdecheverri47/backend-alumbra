import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class CreateGroupSessionInput {
  @Field(() => ID)
  groupId!: string;

  @Field(() => Date, { description: 'Fecha canónica de la reunión de esa semana.' })
  scheduledFor!: Date;

  @Field(() => Date, { nullable: true, description: 'Default: scheduledFor.' })
  startsAt?: Date;

  @Field(() => String, { nullable: true, description: 'Tema de la clase.' })
  title?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Clase del currículo (cohortes). En la Ruta debe respetar el orden.',
  })
  lessonId?: string;
}

@InputType()
export class AddSessionMaterialInput {
  @Field(() => ID)
  sessionId!: string;

  @Field()
  title!: string;

  @Field({ description: 'URL devuelta por POST /uploads.' })
  url!: string;
}

@InputType()
export class CreateSessionAssignmentInput {
  @Field(() => ID)
  sessionId!: string;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => Date, { nullable: true })
  dueAt?: Date;
}
