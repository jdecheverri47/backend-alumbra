import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { UserModel } from '../../users/dto/user.model';

@ObjectType('CourseLessonTask')
export class CourseLessonTaskModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  order!: number;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;
}

@ObjectType('CourseLesson')
export class CourseLessonModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  order!: number;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => [CourseLessonTaskModel])
  tasks!: CourseLessonTaskModel[];
}

@ObjectType('CourseTopic')
export class CourseTopicModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  order!: number;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => [CourseLessonModel])
  lessons!: CourseLessonModel[];
}

@ObjectType('Course')
export class CourseModel {
  @Field(() => ID)
  id!: string;

  @Field()
  slug!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => CourseModel, { nullable: true, description: 'Curso requerido antes de este.' })
  prerequisite?: CourseModel | null;

  @Field(() => [CourseTopicModel])
  topics!: CourseTopicModel[];
}

@ObjectType('CourseCompletion')
export class CourseCompletionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => CourseModel)
  course!: CourseModel;

  @Field(() => Date)
  completedAt!: Date;

  @Field(() => UserModel)
  certifiedBy!: UserModel;
}
