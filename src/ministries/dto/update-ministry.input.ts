import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class UpdateMinistryInput {
  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  description?: string | null;
}
