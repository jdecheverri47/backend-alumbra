import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CoursesService } from './courses.service';
import { CourseCompletionModel, CourseModel } from './dto/course.models';

@Resolver(() => CourseModel)
export class CoursesResolver {
  constructor(private readonly coursesService: CoursesService) {}

  @Query(() => [CourseModel], { description: 'Cursos con su currículo (temas → clases → tareas).' })
  async courses(): Promise<CourseModel[]> {
    return this.coursesService.list();
  }

  @Query(() => [CourseCompletionModel], { description: 'Cursos certificados de una persona.' })
  async courseCompletions(
    @Args('userId', { type: () => ID }) userId: string,
  ): Promise<CourseCompletionModel[]> {
    return this.coursesService.completionsFor(userId);
  }

  // Líder de una cohorte del curso o pastor (validado en el service).
  @Mutation(() => CourseCompletionModel)
  async certifyCourseCompletion(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('courseId', { type: () => ID }) courseId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<CourseCompletionModel> {
    return this.coursesService.certifyCompletion(me, userId, courseId);
  }
}
