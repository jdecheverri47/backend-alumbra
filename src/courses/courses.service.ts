import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Course, CourseCompletion, CourseEnrollment, Group, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { GroupsService } from '../groups/groups.service';
import { toUserModel } from '../users/dto/to-user-model';
import { CourseCompletionModel, CourseEnrollmentModel, CourseModel } from './dto/course.models';

export const EVANGELIO_SLUG = 'evangelio';
export const RUTA_SLUG = 'ruta-crecimiento';

const COURSE_INCLUDE = {
  prerequisite: true,
  topics: {
    orderBy: { order: 'asc' as const },
    include: {
      lessons: {
        orderBy: { order: 'asc' as const },
        include: { tasks: { orderBy: { order: 'asc' as const } } },
      },
    },
  },
};

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groupsService: GroupsService,
  ) {}

  // ── Inscripciones abiertas (Evangelio) ─────────────────────────────────────

  /** Auto-inscripción al curso de Evangelio (abierto; solo no miembros). */
  async enroll(me: AuthenticatedUser, courseId: string): Promise<CourseEnrollmentModel> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException(`Course ${courseId} not found.`);
    if (course.slug !== EVANGELIO_SLUG) {
      throw new BadRequestException('Solo el curso de Evangelio tiene inscripción abierta.');
    }

    try {
      const row = await this.prisma.courseEnrollment.create({
        data: { userId: me.sub, courseId },
        include: { user: true, course: true, placedGroup: true },
      });
      return this.toEnrollmentModel(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya estás inscrito en este curso.');
      }
      throw e;
    }
  }

  async myEnrollments(me: AuthenticatedUser): Promise<CourseEnrollmentModel[]> {
    const rows = await this.prisma.courseEnrollment.findMany({
      where: { userId: me.sub },
      include: { user: true, course: true, placedGroup: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toEnrollmentModel(row));
  }

  /** Inscritos pendientes de cohorte. Pastores o líderes de cohortes del curso. */
  async pendingEnrollments(
    me: AuthenticatedUser,
    courseId: string,
  ): Promise<CourseEnrollmentModel[]> {
    if (!me.isPastor) {
      const ledCohort = await this.prisma.group.findFirst({
        where: { courseId, leaderId: me.sub, archivedAt: null },
      });
      if (!ledCohort) {
        throw new ForbiddenException({
          error: 'FORBIDDEN',
          message: 'Solo pastores o líderes de cohortes del curso ven los inscritos.',
        });
      }
    }
    const rows = await this.prisma.courseEnrollment.findMany({
      where: { courseId, placedAt: null },
      include: { user: true, course: true, placedGroup: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toEnrollmentModel(row));
  }

  /** Mueve al inscrito a una cohorte (pastor, o líder de la cohorte destino). */
  async placeEnrollment(
    me: AuthenticatedUser,
    enrollmentId: string,
    groupId: string,
  ): Promise<CourseEnrollmentModel> {
    const enrollment = await this.prisma.courseEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { course: true },
    });
    if (!enrollment) throw new NotFoundException(`Enrollment ${enrollmentId} not found.`);
    if (enrollment.placedAt) {
      throw new ConflictException('Esta inscripción ya fue asignada a una cohorte.');
    }

    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group || group.courseId !== enrollment.courseId || group.archivedAt) {
      throw new BadRequestException('La cohorte destino debe ser una cohorte activa del curso.');
    }

    // addMember valida permisos (pastor o líder de la cohorte) y las reglas del curso.
    await this.groupsService.addMember(me, { userId: enrollment.userId, groupId });

    const row = await this.prisma.courseEnrollment.update({
      where: { id: enrollmentId },
      data: { placedGroupId: groupId, placedAt: new Date(), placedById: me.sub },
      include: { user: true, course: true, placedGroup: true },
    });
    return this.toEnrollmentModel(row);
  }

  private toEnrollmentModel(
    row: CourseEnrollment & { user: User; course: Course; placedGroup: Group | null },
  ): CourseEnrollmentModel {
    return {
      id: row.id,
      user: toUserModel(row.user),
      courseSlug: row.course.slug,
      courseName: row.course.name,
      createdAt: row.createdAt,
      placedGroupId: row.placedGroupId,
      placedGroupName: row.placedGroup?.name ?? null,
      placedAt: row.placedAt,
    };
  }

  async list(): Promise<CourseModel[]> {
    const rows = await this.prisma.course.findMany({
      include: COURSE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toModel(row));
  }

  async findBySlugOrThrow(slug: string): Promise<Course> {
    const course = await this.prisma.course.findUnique({ where: { slug } });
    if (!course) throw new NotFoundException(`Course "${slug}" not found.`);
    return course;
  }

  /** Parte del expediente formativo: visible solo para la propia persona, líderes y pastores. */
  async completionsFor(me: AuthenticatedUser, userId: string): Promise<CourseCompletionModel[]> {
    if (userId !== me.sub && !me.isPastor && !me.user.isLeader) return [];
    const rows = await this.prisma.courseCompletion.findMany({
      where: { userId },
      include: { course: { include: COURSE_INCLUDE }, certifiedBy: true },
      orderBy: { completedAt: 'asc' },
    });
    return rows.map((row) => this.toCompletionModel(row));
  }

  async hasCompleted(userId: string, courseSlug: string): Promise<boolean> {
    const completion = await this.prisma.courseCompletion.findFirst({
      where: { userId, course: { slug: courseSlug } },
    });
    return Boolean(completion);
  }

  /** Certifica que una persona terminó un curso. Líder de una cohorte del curso o pastor. */
  async certifyCompletion(
    me: AuthenticatedUser,
    userId: string,
    courseId: string,
  ): Promise<CourseCompletionModel> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException(`Course ${courseId} not found.`);

    if (!me.isPastor) {
      const ledCohort = await this.prisma.group.findFirst({
        where: { courseId, leaderId: me.sub, archivedAt: null },
      });
      if (!ledCohort) {
        throw new ForbiddenException({
          error: 'FORBIDDEN',
          message: 'Solo el líder de una cohorte del curso o un pastor puede certificarlo.',
        });
      }
    }

    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found.`);

    const row = await this.prisma.courseCompletion.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, certifiedById: me.sub },
      update: {}, // idempotente: conserva la certificación original
      include: { course: { include: COURSE_INCLUDE }, certifiedBy: true },
    });
    return this.toCompletionModel(row);
  }

  private toModel(
    row: Course & {
      prerequisite?: Course | null;
      topics: Array<{
        id: string;
        order: number;
        title: string;
        description: string | null;
        lessons: Array<{
          id: string;
          order: number;
          title: string;
          description: string | null;
          tasks: Array<{ id: string; order: number; title: string; description: string | null }>;
        }>;
      }>;
    },
  ): CourseModel {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      prerequisite: row.prerequisite
        ? {
            id: row.prerequisite.id,
            slug: row.prerequisite.slug,
            name: row.prerequisite.name,
            description: row.prerequisite.description,
            prerequisite: null,
            topics: [],
          }
        : null,
      topics: row.topics.map((topic) => ({
        id: topic.id,
        order: topic.order,
        title: topic.title,
        description: topic.description,
        lessons: topic.lessons.map((lesson) => ({
          id: lesson.id,
          order: lesson.order,
          title: lesson.title,
          description: lesson.description,
          tasks: lesson.tasks,
        })),
      })),
    };
  }

  private toCompletionModel(
    row: CourseCompletion & {
      course: Parameters<CoursesService['toModel']>[0];
      certifiedBy: User;
    },
  ): CourseCompletionModel {
    return {
      id: row.id,
      course: this.toModel(row.course),
      completedAt: row.completedAt,
      certifiedBy: toUserModel(row.certifiedBy),
    };
  }
}
