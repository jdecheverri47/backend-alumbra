import { Field, InputType, Int } from '@nestjs/graphql';

@InputType()
export class PaginationInput {
  @Field(() => Int, { defaultValue: 20 })
  first: number = 20;

  @Field(() => String, { nullable: true })
  after?: string;
}
