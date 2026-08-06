import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class UpdateEventInput {
  @Field(() => String, { nullable: true })
  title?: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  location?: string | null;

  @Field(() => Date, { nullable: true, description: 'null = quitar la fecha (queda por definir).' })
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;

  @Field(() => Boolean, {
    nullable: true,
    description: 'true = solo para miembros; no se muestra a asistentes.',
  })
  membersOnly?: boolean;
}
