import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserModel } from '../../users/dto/user.model';
import { MinistryRole } from './ministry-role.enum';
import { MinistryModel } from './ministry.model';

@ObjectType('MinistryMembership')
export class MinistryMembershipModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  user!: UserModel;

  @Field(() => MinistryModel)
  ministry!: MinistryModel;

  @Field(() => MinistryRole)
  role!: MinistryRole;

  @Field(() => Date)
  joinedAt!: Date;

  @Field(() => Date, { nullable: true })
  leftAt?: Date | null;
}
