import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Course, CourseCompletion, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { toUserModel } from '../users/dto/to-user-model';
import { CourseCompletionModel, CourseModel } from './dto/course.models';

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
  constructor(private readonly prisma: PrismaService) {}

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
