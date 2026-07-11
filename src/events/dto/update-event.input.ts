import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class UpdateEventInput {
  @Field(() => String, { nullable: true })
  title?: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  location?: string | null;

  @Field(() => Date, { nullable: true })
  startsAt?: Date;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;
}
