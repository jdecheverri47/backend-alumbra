import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { UserModel } from '../../users/dto/user.model';
import { FollowUpKind, NewcomerInterest, NewcomerStatus } from './newcomer-enums';

@ObjectType('NewcomerFollowUp')
export class NewcomerFollowUpModel {
  @Field(() => ID)
  id!: string;

  @Field(() => FollowUpKind)
  kind!: FollowUpKind;

  @Field()
  note!: string;

  @Field(() => UserModel)
  author!: UserModel;

  @Field(() => Date)
  createdAt!: Date;
}

@ObjectType('Newcomer')
export class NewcomerModel {
  @Field(() => ID)
  id!: string;

  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  @Field()
  fullName!: string;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => Date, { nullable: true })
  birthDate?: Date | null;

  @Field(() => String, { nullable: true })
  neighborhood?: string | null;

  @Field(() => Date)
  firstVisitAt!: Date;

  @Field(() => String, { nullable: true })
  howHeard?: string | null;

  @Field(() => String, { nullable: true })
  invitedBy?: string | null;

  @Field(() => [NewcomerInterest])
  interests!: NewcomerInterest[];

  @Field(() => String, { nullable: true })
  prayerRequest?: string | null;

  @Field(() => String, { nullable: true })
  notes?: string | null;

  @Field()
  consent!: boolean;

  @Field(() => NewcomerStatus)
  status!: NewcomerStatus;

  @Field(() => UserModel)
  registeredBy!: UserModel;

  @Field(() => UserModel, { nullable: true })
  assignedTo?: UserModel | null;

  @Field(() => Int)
  followUpCount!: number;

  @Field(() => Date, { nullable: true })
  lastFollowUpAt?: Date | null;

  @Field(() => Date)
  createdAt!: Date;

  // followUps se resuelve aparte (solo al abrir el detalle).
}
