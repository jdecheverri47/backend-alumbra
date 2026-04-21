import { Field, ID, InputType } from '@nestjs/graphql';
import { MinistryRole } from './ministry-role.enum';

@InputType()
export class AddUserToMinistryInput {
  @Field(() => ID)
  userId!: string;

  @Field(() => ID)
  ministryId!: string;

  @Field(() => MinistryRole)
  role!: MinistryRole;
}
