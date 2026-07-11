import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class AddUserToGroupInput {
  @Field(() => ID)
  userId!: string;

  @Field(() => ID)
  groupId!: string;
}
