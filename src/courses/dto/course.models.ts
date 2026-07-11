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

@ObjectType('CourseEnrollment', {
  description: 'Inscripción abierta a un curso, pendiente de que lo muevan a una cohorte.',
})
export class CourseEnrollmentModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  user!: UserModel;

  @Field()
  courseSlug!: string;

  @Field()
  courseName!: string;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => String, { nullable: true, description: 'Cohorte a la que fue movido.' })
  placedGroupId?: string | null;

  @Field(() => String, { nullable: true })
  placedGroupName?: string | null;

  @Field(() => Date, { nullable: true })
  placedAt?: Date | null;
}

@ObjectType('CourseCompletion')
export class CourseCompletionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel, { nullable: true, description: 'La persona certificada.' })
  user?: UserModel | null;

  @Field(() => CourseModel)
  course!: CourseModel;

  @Field(() => Date)
  completedAt!: Date;

  @Field(() => UserModel)
  certifiedBy!: UserModel;
}
