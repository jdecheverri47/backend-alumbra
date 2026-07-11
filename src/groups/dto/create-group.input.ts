import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { GroupType } from './group-type.enum';

@InputType()
export class CreateGroupInput {
  @Field(() => GroupType)
  type!: GroupType;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => ID, { nullable: true, description: 'Default: quien crea el grupo.' })
  leaderId?: string;

  @Field(() => ID, { nullable: true, description: 'Curso, cuando el grupo es una cohorte.' })
  courseId?: string;

  @Field(() => Int, { nullable: true, description: '0=domingo … 6=sábado' })
  meetingDay?: number;

  @Field(() => String, { nullable: true, description: '"HH:mm"' })
  meetingTime?: string;

  @Field(() => String, { nullable: true })
  location?: string;
}
