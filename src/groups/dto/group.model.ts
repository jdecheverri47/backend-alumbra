import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { UserModel } from '../../users/dto/user.model';
import { GroupType } from './group-type.enum';

@ObjectType('GroupCourse', { description: 'Curso al que pertenece una cohorte.' })
export class GroupCourseModel {
  @Field(() => ID)
  id!: string;

  @Field()
  slug!: string;

  @Field()
  name!: string;
}

@ObjectType('Group')
export class GroupModel {
  @Field(() => ID)
  id!: string;

  @Field(() => GroupType)
  type!: GroupType;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => UserModel)
  leader!: UserModel;

  @Field(() => GroupCourseModel, { nullable: true, description: 'Solo cohortes (type CURSO).' })
  course?: GroupCourseModel | null;

  @Field(() => Int, { nullable: true, description: '0=domingo … 6=sábado' })
  meetingDay?: number | null;

  @Field(() => String, { nullable: true, description: 'Hora local "HH:mm"' })
  meetingTime?: string | null;

  @Field(() => String, { nullable: true })
  location?: string | null;

  @Field(() => Date, { nullable: true })
  archivedAt?: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}
