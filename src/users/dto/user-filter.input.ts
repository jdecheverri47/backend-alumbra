import { Field, InputType } from '@nestjs/graphql';
import { BaseRole } from './base-role.enum';

@InputType()
export class UserFilterInput {
  @Field(() => BaseRole, { nullable: true })
  baseRole?: BaseRole;

  @Field(() => Boolean, { nullable: true })
  isPastor?: boolean;

  @Field(() => String, { nullable: true })
  ministryId?: string;

  @Field(() => String, { nullable: true })
  search?: string;
}
