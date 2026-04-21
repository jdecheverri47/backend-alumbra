import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class CreateMinistryInput {
  @Field()
  slug!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;
}
