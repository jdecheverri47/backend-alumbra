import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { InstituteRequestStatus } from '@prisma/client';
import { UserModel } from '../../users/dto/user.model';

registerEnumType(InstituteRequestStatus, { name: 'InstituteRequestStatus' });

export { InstituteRequestStatus };

@ObjectType('InstituteRequest')
export class InstituteRequestModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  user!: UserModel;

  @Field(() => String, { nullable: true, description: 'Lo que escribió al pedir entrar.' })
  note?: string | null;

  @Field(() => InstituteRequestStatus)
  status!: InstituteRequestStatus;

  @Field(() => String, { nullable: true, description: 'Motivo del rechazo, si lo hubo.' })
  reviewNote?: string | null;

  @Field(() => String, { nullable: true })
  reviewedByName?: string | null;

  @Field(() => Date, { nullable: true })
  reviewedAt?: Date | null;

  @Field(() => [String], { description: 'Ministerios en que sirve, para decidir.' })
  ministries!: string[];

  @Field(() => [String], { description: 'Grupos a los que pertenece.' })
  groups!: string[];

  @Field()
  createdAt!: Date;
}

@ObjectType('MyInstituteRequest')
export class MyInstituteRequestModel {
  @Field(() => InstituteRequestModel, { nullable: true, description: 'La última que hizo.' })
  request?: InstituteRequestModel | null;

  @Field({ description: 'Puede pedir entrar ahora mismo.' })
  canRequest!: boolean;

  @Field(() => Date, {
    nullable: true,
    description: 'Si la rechazaron hace poco, desde cuándo puede volver a pedirla.',
  })
  canRequestAgainAt?: Date | null;
}
