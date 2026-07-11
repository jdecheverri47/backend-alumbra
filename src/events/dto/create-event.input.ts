import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class CreateEventInput {
  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  location?: string;

  @Field(() => Date)
  startsAt!: Date;

  @Field(() => Date, { nullable: true })
  endsAt?: Date;

  @Field(() => ID, { nullable: true, description: 'null = evento general (solo pastores).' })
  groupId?: string;
}
