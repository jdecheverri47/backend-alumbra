import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class MembershipInfoInput {
  @Field(() => Date, { nullable: true, description: 'Fecha de anexo a membresía.' })
  membershipDate?: Date | null;

  @Field(() => Date, { nullable: true, description: 'Fecha de bautismo.' })
  baptismDate?: Date | null;
}
