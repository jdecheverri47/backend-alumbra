import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CoursesService } from './courses.service';
import { CourseCompletionModel, CourseEnrollmentModel, CourseModel } from './dto/course.models';

@Resolver(() => CourseModel)
export class CoursesResolver {
  constructor(private readonly coursesService: CoursesService) {}

  @Query(() => [CourseModel], { description: 'Cursos con su currículo (temas → clases → tareas).' })
  async courses(): Promise<CourseModel[]> {
    return this.coursesService.list();
  }

  @Query(() => [CourseCompletionModel], {
    description: 'Cursos certificados de una persona (la propia persona, líderes y pastores).',
  })
  async courseCompletions(
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<CourseCompletionModel[]> {
    return this.coursesService.completionsFor(me, userId);
  }

  @Query(() => [CourseEnrollmentModel], { description: 'Mis inscripciones a cursos.' })
  async myCourseEnrollments(
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<CourseEnrollmentModel[]> {
    return this.coursesService.myEnrollments(me);
  }

  // Pastores o líderes de cohortes del curso (validado en el service).
  @Query(() => [CourseEnrollmentModel], {
    description: 'Inscritos pendientes de cohorte de un curso.',
  })
  async pendingCourseEnrollments(
    @Args('courseId', { type: () => ID }) courseId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<CourseEnrollmentModel[]> {
    return this.coursesService.pendingEnrollments(me, courseId);
  }

  @Mutation(() => CourseEnrollmentModel, {
    description: 'Auto-inscripción al curso de Evangelio (solo no miembros).',
  })
  async enrollInCourse(
    @Args('courseId', { type: () => ID }) courseId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<CourseEnrollmentModel> {
    return this.coursesService.enroll(me, courseId);
  }

  // Pastor o líder de la cohorte destino (validado en el service).
  @Mutation(() => CourseEnrollmentModel, {
    description: 'Mueve al inscrito a una cohorte con líder.',
  })
  async placeCourseEnrollment(
    @Args('enrollmentId', { type: () => ID }) enrollmentId: string,
    @Args('groupId', { type: () => ID }) groupId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<CourseEnrollmentModel> {
    return this.coursesService.placeEnrollment(me, enrollmentId, groupId);
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
