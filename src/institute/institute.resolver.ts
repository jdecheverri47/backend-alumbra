import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { InstituteRole } from './dto/institute-enums';
import {
  InstituteClassInput,
  InstituteEnrollInput,
  InstituteGradeInput,
  InstituteItemInput,
  InstituteModuleInput,
} from './dto/institute.inputs';
import {
  InstituteAccessModel,
  InstituteCalendarEntryModel,
  InstituteClassModel,
  InstituteEnrollmentModel,
  InstituteGradebookModel,
  InstituteItemModel,
  InstituteModuleModel,
  InstituteSubmissionModel,
} from './dto/institute.models';
import { InstituteService } from './institute.service';

/** El Instituto Bíblico. Los permisos los decide InstituteService. */
@Resolver()
export class InstituteResolver {
  constructor(private readonly service: InstituteService) {}

  @Query(() => InstituteAccessModel, { description: 'Qué puede hacer quien consulta.' })
  async myInstitute(@CurrentUser() me: AuthenticatedUser): Promise<InstituteAccessModel> {
    return this.service.access(me);
  }

  @Query(() => [InstituteModuleModel])
  async instituteModules(@CurrentUser() me: AuthenticatedUser): Promise<InstituteModuleModel[]> {
    return this.service.modules(me);
  }

  @Query(() => [InstituteSubmissionModel], {
    description: 'Cada alumno con su entrega de esta tarea. Profesores.',
  })
  async instituteSubmissions(
    @CurrentUser() me: AuthenticatedUser,
    @Args('itemId', { type: () => ID }) itemId: string,
  ): Promise<InstituteSubmissionModel[]> {
    return this.service.submissions(me, itemId);
  }

  @Query(() => InstituteGradebookModel)
  async instituteGradebook(@CurrentUser() me: AuthenticatedUser): Promise<InstituteGradebookModel> {
    return this.service.gradebook(me);
  }

  @Query(() => [InstituteEnrollmentModel])
  async instituteRoster(@CurrentUser() me: AuthenticatedUser): Promise<InstituteEnrollmentModel[]> {
    return this.service.roster(me);
  }

  @Mutation(() => InstituteModuleModel)
  async createInstituteModule(
    @CurrentUser() me: AuthenticatedUser,
    @Args('input') input: InstituteModuleInput,
  ): Promise<InstituteModuleModel> {
    return this.service.createModule(me, input);
  }

  @Mutation(() => InstituteModuleModel)
  async updateInstituteModule(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: InstituteModuleInput,
  ): Promise<InstituteModuleModel> {
    return this.service.updateModule(me, id, input);
  }

  @Mutation(() => InstituteItemModel)
  async createInstituteItem(
    @CurrentUser() me: AuthenticatedUser,
    @Args('input') input: InstituteItemInput,
  ): Promise<InstituteItemModel> {
    return this.service.saveItem(me, null, input);
  }

  @Mutation(() => InstituteItemModel)
  async updateInstituteItem(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: InstituteItemInput,
  ): Promise<InstituteItemModel> {
    return this.service.saveItem(me, id, input);
  }

  @Mutation(() => Boolean)
  async deleteInstituteItem(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.service.deleteItem(me, id);
  }

  @Mutation(() => InstituteItemModel, {
    description: 'El alumno marca la tarea como entregada (turnIn: false la retira).',
  })
  async turnInInstituteItem(
    @CurrentUser() me: AuthenticatedUser,
    @Args('itemId', { type: () => ID }) itemId: string,
    @Args('turnIn', { defaultValue: true }) turnIn: boolean,
  ): Promise<InstituteItemModel> {
    return this.service.turnIn(me, itemId, turnIn);
  }

  @Mutation(() => InstituteSubmissionModel)
  async gradeInstituteSubmission(
    @CurrentUser() me: AuthenticatedUser,
    @Args('input') input: InstituteGradeInput,
  ): Promise<InstituteSubmissionModel> {
    return this.service.grade(me, input);
  }

  @Mutation(() => [InstituteEnrollmentModel])
  async enrollInInstitute(
    @CurrentUser() me: AuthenticatedUser,
    @Args('input') input: InstituteEnrollInput,
  ): Promise<InstituteEnrollmentModel[]> {
    return this.service.enroll(me, input.userIds, input.role as InstituteRole);
  }

  @Mutation(() => Boolean)
  async removeFromInstitute(
    @CurrentUser() me: AuthenticatedUser,
    @Args('enrollmentId', { type: () => ID }) enrollmentId: string,
  ): Promise<boolean> {
    return this.service.unenroll(me, enrollmentId);
  }

  @Query(() => [InstituteClassModel], { description: 'Clases programadas del instituto.' })
  async instituteClasses(@CurrentUser() me: AuthenticatedUser): Promise<InstituteClassModel[]> {
    return this.service.classes(me);
  }

  @Query(() => [InstituteCalendarEntryModel], {
    description:
      'Clases y fechas límite del instituto en [from, to] para el calendario. Vacío si no está inscrito.',
  })
  async instituteCalendar(
    @CurrentUser() me: AuthenticatedUser,
    @Args('from', { type: () => Date }) from: Date,
    @Args('to', { type: () => Date }) to: Date,
  ): Promise<InstituteCalendarEntryModel[]> {
    return this.service.calendar(me, from, to);
  }

  @Mutation(() => InstituteClassModel)
  async createInstituteClass(
    @CurrentUser() me: AuthenticatedUser,
    @Args('input') input: InstituteClassInput,
  ): Promise<InstituteClassModel> {
    return this.service.saveClass(me, null, input);
  }

  @Mutation(() => InstituteClassModel)
  async updateInstituteClass(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: InstituteClassInput,
  ): Promise<InstituteClassModel> {
    return this.service.saveClass(me, id, input);
  }

  @Mutation(() => Boolean)
  async deleteInstituteClass(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.service.deleteClass(me, id);
  }
}
