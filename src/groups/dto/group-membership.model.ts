import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserModel } from '../../users/dto/user.model';

@ObjectType('GroupMembership')
export class GroupMembershipModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  user!: UserModel;

  @Field(() => Date)
  joinedAt!: Date;

  @Field(() => Date, { nullable: true })
  leftAt?: Date | null;
}
