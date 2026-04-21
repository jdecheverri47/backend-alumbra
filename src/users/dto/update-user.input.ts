import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class UpdateUserInput {
  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field({ nullable: true })
  phone?: string | null;

  @Field({ nullable: true })
  photoUrl?: string | null;

  @Field(() => Date, { nullable: true })
  birthDate?: Date | null;
}
