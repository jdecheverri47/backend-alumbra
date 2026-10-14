import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('PollOption')
export class PollOptionModel {
  @Field(() => ID)
  id!: string;

  @Field()
  text!: string;

  @Field(() => Int)
  votes!: number;
}

@ObjectType('Poll')
export class PollModel {
  @Field(() => ID)
  id!: string;

  @Field(() => [PollOptionModel], { description: 'En el orden en que se escribieron.' })
  options!: PollOptionModel[];

  @Field(() => Int)
  totalVotes!: number;

  @Field(() => ID, { nullable: true, description: 'La opción que voté, o null si no he votado.' })
  myVoteOptionId?: string | null;

  @Field(() => Date, { nullable: true, description: 'null = no cierra.' })
  closesAt?: Date | null;

  @Field()
  isClosed!: boolean;
}
