import { Field, ID, InputType } from '@nestjs/graphql';
import { FollowUpKind, NewcomerInterest, NewcomerStatus } from './newcomer-enums';

@InputType()
export class NewcomerInput {
  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => Date, { nullable: true })
  birthDate?: Date | null;

  @Field(() => String, { nullable: true, description: 'Barrio o ciudad.' })
  neighborhood?: string | null;

  @Field(() => Date, { nullable: true, description: 'Por defecto, hoy.' })
  firstVisitAt?: Date;

  @Field(() => String, { nullable: true, description: 'Cómo se enteró de la iglesia.' })
  howHeard?: string | null;

  @Field(() => String, { nullable: true })
  invitedBy?: string | null;

  @Field(() => [NewcomerInterest], { nullable: true })
  interests?: NewcomerInterest[];

  @Field(() => String, { nullable: true })
  prayerRequest?: string | null;

  @Field(() => String, { nullable: true })
  notes?: string | null;

  @Field({ nullable: true, description: 'Aceptó que la contacten y que se guarden sus datos.' })
  consent?: boolean;
}

@InputType()
export class NewcomerFilterInput {
  @Field(() => NewcomerStatus, { nullable: true })
  status?: NewcomerStatus;

  @Field({ nullable: true, description: 'Nombre, teléfono o correo.' })
  search?: string;

  @Field({ nullable: true, description: 'Solo las asignadas a quien consulta.' })
  assignedToMe?: boolean;
}

@InputType()
export class AddFollowUpInput {
  @Field(() => ID)
  newcomerId!: string;

  @Field(() => FollowUpKind, { defaultValue: 'LLAMADA' })
  kind!: FollowUpKind;

  @Field()
  note!: string;
}
