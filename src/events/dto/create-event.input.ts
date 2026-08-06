import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class CreateEventInput {
  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  location?: string;

  @Field(() => String, {
    nullable: true,
    description: 'Afiche del evento: ruta /uploads/... o URL http(s).',
  })
  imageUrl?: string;

  @Field(() => Date, { nullable: true, description: 'null = fecha por definir.' })
  startsAt?: Date;

  @Field(() => Date, { nullable: true })
  endsAt?: Date;

  @Field(() => ID, { nullable: true, description: 'null = evento general (solo pastores).' })
  groupId?: string;

  @Field(() => Boolean, {
    nullable: true,
    defaultValue: false,
    description: 'true = solo para miembros; no se muestra a asistentes.',
  })
  membersOnly?: boolean;
}
