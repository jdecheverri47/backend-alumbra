import { Field, ID, ObjectType } from '@nestjs/graphql';
import { BaseRole } from './base-role.enum';

@ObjectType('User')
export class UserModel {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  @Field({ description: 'Computed: firstName + " " + lastName.' })
  fullName!: string;

  @Field(() => BaseRole)
  baseRole!: BaseRole;

  @Field(() => Boolean)
  isPastor!: boolean;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  photoUrl?: string | null;

  @Field(() => Date, { nullable: true })
  birthDate?: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}
