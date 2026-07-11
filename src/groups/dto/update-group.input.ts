import { Field, InputType, Int } from '@nestjs/graphql';

@InputType()
export class UpdateGroupInput {
  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Int, { nullable: true })
  meetingDay?: number | null;

  @Field(() => String, { nullable: true })
  meetingTime?: string | null;

  @Field(() => String, { nullable: true })
  location?: string | null;
}
