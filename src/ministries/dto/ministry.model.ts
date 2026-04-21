import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('Ministry')
export class MinistryModel {
  @Field(() => ID)
  id!: string;

  @Field()
  slug!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Date, { nullable: true })
  archivedAt?: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}
