import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentSubmission,
  Group,
  Prisma,
  SessionAttendance,
  SessionMaterial,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { toGroupModel } from '../groups/dto/to-group-model';
import { toUserModel } from '../users/dto/to-user-model';
import {
  assignmentSchema,
  createSessionSchema,
  materialSchema,
  rescheduleSessionSchema,
  submissionSchema,
} from './dto/inputs.schema';
import {
  AttendanceModel,
  GroupSessionModel,
  SessionAssignmentModel,
  SessionMaterialModel,
  SubmissionModel,
} from './dto/session.models';

const RUTA_SLUG = 'ruta-crecimiento';

const SESSION_INCLUDE = {
  group: { include: { leader: true, course: true } },
  lesson: { include: { topic: true } },
  materials: { include: { uploadedBy: true }, orderBy: { createdAt: 'asc' as const } },
  assignments: {
    include: { submissions: { include: { user: true }, orderBy: { submittedAt: 'asc' as const } } },
    orderBy: { createdAt: 'asc' as const },
  },
  attendances: { include: { user: true }, orderBy: { checkedInAt: 'asc' as const } },
};

type SessionRow = Prisma.GroupSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

@Injectable()
export class GroupSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  async listByGroup(me: AuthenticatedUser, groupId: string): Promise<GroupSessionModel[]> {
    const group = await this.getGroupOrThrow(groupId);
    await this.assertViewer(me, group);
    const privileged = this.isLeaderOrPastor(me, group);
    const rows = await this.prisma.groupSession.findMany({
      where: { groupId },
      include: SESSION_INCLUDE,
      orderBy: { startsAt: 'desc' },
    });
    return rows.map((row) => this.toModel(row, me, privileged));
  }

  async findForViewer(me: AuthenticatedUser, id: string): Promise<GroupSessionModel> {
    const row = await this.getSessionOrThrow(id);
    await this.assertViewer(me, row.group);
    return this.toModel(row, me, this.isLeaderOrPastor(me, row.group));
  }

  /** Clases de mis grupos (pastor: todas) que tocan el rango, para el calendario. */
  async listInRange(me: AuthenticatedUser, from: Date, to: Date): Promise<GroupSessionModel[]> {
    const membership = me.isPastor
      ? {}
      : {
          group: {
            OR: [{ leaderId: me.sub }, { memberships: { some: { userId: me.sub, leftAt: null } } }],
          },
        };
    const rows = await this.prisma.groupSession.findMany({
      where: {
        ...membership,
        OR: [{ startsAt: { gte: from, lte: to } }, { scheduledFor: { gte: from, lte: to } }],
      },
      include: SESSION_INCLUDE,
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((row) => this.toModel(row, me, this.isLeaderOrPastor(me, row.group)));
  }

  // ── Clases ─────────────────────────────────────────────────────────────────

  async create(me: AuthenticatedUser, raw: unknown): Promise<GroupSessionModel> {
    const data = createSessionSchema.parse(raw);
    const group = await this.prisma.group.findUnique({
      where: { id: data.groupId },
      include: { course: true },
    });
    if (!group) throw new NotFoundException(`Group ${data.groupId} not found.`);
    this.assertLeaderOrPastor(me, group);
    if (group.archivedAt) {
      throw new BadRequestException('El grupo está archivado.');
    }

    let lessonTitle: string | undefined;
    let lessonTasks: Array<{ title: string; description: string | null }> = [];
    if (data.lessonId) {
      if (!group.courseId) {
        throw new BadRequestException('Este grupo no es una cohorte de un curso.');
      }
      const lesson = await this.prisma.courseLesson.findUnique({
        where: { id: data.lessonId },
        include: { topic: true, tasks: { orderBy: { order: 'asc' } } },
      });
      if (!lesson || lesson.topic.courseId !== group.courseId) {
        throw new BadRequestException('La clase no pertenece al curso de esta cohorte.');
      }

      // En la Ruta la taxonomía se respeta: solo se programa la siguiente clase pendiente.
      if (group.course?.slug === RUTA_SLUG) {
        await this.assertLessonIsNext(group.id, group.courseId, lesson.id);
      }

      lessonTitle = lesson.title;
      lessonTasks = lesson.tasks.map((t) => ({ title: t.title, description: t.description }));
    }

    try {
      const row = await this.prisma.groupSession.create({
        data: {
          groupId: data.groupId,
          scheduledFor: data.scheduledFor,
          startsAt: data.startsAt ?? data.scheduledFor,
          title: data.title ?? lessonTitle,
          lessonId: data.lessonId,
          createdById: me.sub,
          // Las tareas de la plantilla del currículo se dejan automáticamente.
          assignments: { create: lessonTasks },
        },
        include: SESSION_INCLUDE,
      });
      return this.toModel(row, me, true);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe una clase programada para esa fecha.');
      }
      throw e;
    }
  }

  /** Todas las clases anteriores del currículo deben tener sesión creada en esta cohorte. */
  private async assertLessonIsNext(
    groupId: string,
    courseId: string,
    lessonId: string,
  ): Promise<void> {
    const topics = await this.prisma.courseTopic.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      include: { lessons: { orderBy: { order: 'asc' } } },
    });
    const orderedLessonIds = topics.flatMap((t) => t.lessons.map((l) => l.id));
    const index = orderedLessonIds.indexOf(lessonId);
    if (index === -1) throw new BadRequestException('La clase no pertenece al curso.');

    const previousIds = orderedLessonIds.slice(0, index);
    if (previousIds.length === 0) return;
    const scheduled = await this.prisma.groupSession.findMany({
      where: { groupId, lessonId: { in: previousIds } },
      select: { lessonId: true },
    });
    const scheduledIds = new Set(scheduled.map((s) => s.lessonId));
    const missing = previousIds.filter((id) => !scheduledIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        'La Ruta se cursa en orden: primero programa las clases anteriores del temario.',
      );
    }
  }

  async reschedule(me: AuthenticatedUser, id: string, raw: unknown): Promise<GroupSessionModel> {
    const { startsAt, note } = rescheduleSessionSchema.parse(raw);
    const session = await this.getSessionOrThrow(id);
    this.assertLeaderOrPastor(me, session.group);
    const row = await this.prisma.groupSession.update({
      where: { id },
      // Reprogramar una clase cancelada la reactiva.
      data: { startsAt, note: note ?? session.note, status: 'REPROGRAMADA' },
      include: SESSION_INCLUDE,
    });
    return this.toModel(row, me, true);
  }

  /** Marca la clase como dictada. */
  async complete(me: AuthenticatedUser, id: string): Promise<GroupSessionModel> {
    const session = await this.getSessionOrThrow(id);
    this.assertLeaderOrPastor(me, session.group);
    if (session.status === 'CANCELADA') {
      throw new BadRequestException('Una clase cancelada no se puede marcar como completada.');
    }
    const row = await this.prisma.groupSession.update({
      where: { id },
      data: { status: 'COMPLETADA' },
      include: SESSION_INCLUDE,
    });
    return this.toModel(row, me, true);
  }

  async cancel(me: AuthenticatedUser, id: string, note?: string): Promise<GroupSessionModel> {
    const session = await this.getSessionOrThrow(id);
    this.assertLeaderOrPastor(me, session.group);
    const row = await this.prisma.groupSession.update({
      where: { id },
      data: { status: 'CANCELADA', note: note ?? session.note },
      include: SESSION_INCLUDE,
    });
    return this.toModel(row, me, true);
  }

  // ── Asistencia ─────────────────────────────────────────────────────────────

  async checkIn(
    me: AuthenticatedUser,
    sessionId: string,
    userId: string,
  ): Promise<AttendanceModel> {
    const session = await this.getSessionOrThrow(sessionId);
    this.assertLeaderOrPastor(me, session.group);
    if (session.status === 'CANCELADA') {
      throw new BadRequestException('La clase está cancelada.');
    }
    await this.assertBelongsToGroup(userId, session.group);

    const existing = await this.prisma.sessionAttendance.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
      include: { user: true },
    });
    // Idempotente: la primera hora de ingreso se conserva.
    if (existing) return this.toAttendance(existing);

    const row = await this.prisma.sessionAttendance.create({
      data: { sessionId, userId, recordedById: me.sub },
      include: { user: true },
    });
    return this.toAttendance(row);
  }

  async undoCheckIn(me: AuthenticatedUser, sessionId: string, userId: string): Promise<boolean> {
    const session = await this.getSessionOrThrow(sessionId);
    this.assertLeaderOrPastor(me, session.group);
    await this.prisma.sessionAttendance.deleteMany({ where: { sessionId, userId } });
    return true;
  }

  // ── Material ───────────────────────────────────────────────────────────────

  async addMaterial(me: AuthenticatedUser, raw: unknown): Promise<SessionMaterialModel> {
    const data = materialSchema.parse(raw);
    const session = await this.getSessionOrThrow(data.sessionId);
    this.assertLeaderOrPastor(me, session.group);
    const row = await this.prisma.sessionMaterial.create({
      data: { ...data, uploadedById: me.sub },
      include: { uploadedBy: true },
    });
    return this.toMaterial(row);
  }

  async removeMaterial(me: AuthenticatedUser, materialId: string): Promise<boolean> {
    const material = await this.prisma.sessionMaterial.findUnique({
      where: { id: materialId },
      include: { session: { include: { group: true } } },
    });
    if (!material) throw new NotFoundException(`Material ${materialId} not found.`);
    this.assertLeaderOrPastor(me, material.session.group);
    await this.prisma.sessionMaterial.delete({ where: { id: materialId } });
    return true;
  }

  // ── Trabajos ───────────────────────────────────────────────────────────────

  async createAssignment(me: AuthenticatedUser, raw: unknown): Promise<SessionAssignmentModel> {
    const data = assignmentSchema.parse(raw);
    const session = await this.getSessionOrThrow(data.sessionId);
    this.assertLeaderOrPastor(me, session.group);
    const row = await this.prisma.sessionAssignment.create({ data });
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      dueAt: row.dueAt,
      createdAt: row.createdAt,
      submissions: [],
      mySubmission: null,
    };
  }

  async submitAssignment(me: AuthenticatedUser, raw: unknown): Promise<SubmissionModel> {
    const { assignmentId, url } = submissionSchema.parse(raw);
    const assignment = await this.prisma.sessionAssignment.findUnique({
      where: { id: assignmentId },
      include: { session: { include: { group: true } } },
    });
    if (!assignment) throw new NotFoundException(`Assignment ${assignmentId} not found.`);
    await this.assertBelongsToGroup(me.sub, assignment.session.group);

    // Re-subir reemplaza la entrega y actualiza la hora.
    const row = await this.prisma.assignmentSubmission.upsert({
      where: { assignmentId_userId: { assignmentId, userId: me.sub } },
      create: { assignmentId, userId: me.sub, url },
      update: { url, submittedAt: new Date() },
      include: { user: true },
    });
    return this.toSubmission(row);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getGroupOrThrow(groupId: string): Promise<Group> {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException(`Group ${groupId} not found.`);
    return group;
  }

  private async getSessionOrThrow(id: string): Promise<SessionRow> {
    const session = await this.prisma.groupSession.findUnique({
      where: { id },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new NotFoundException(`Session ${id} not found.`);
    return session;
  }

  private isLeaderOrPastor(me: AuthenticatedUser, group: Group): boolean {
    return me.isPastor || group.leaderId === me.sub;
  }

  private assertLeaderOrPastor(me: AuthenticatedUser, group: Group): void {
    if (!this.isLeaderOrPastor(me, group)) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo el líder del grupo o un pastor puede hacer esto.',
      });
    }
  }

  private async assertViewer(me: AuthenticatedUser, group: Group): Promise<void> {
    if (this.isLeaderOrPastor(me, group)) return;
    const membership = await this.prisma.groupMembership.findFirst({
      where: { groupId: group.id, userId: me.sub, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'No perteneces a este grupo.' });
    }
  }

  private async assertBelongsToGroup(userId: string, group: Group): Promise<void> {
    if (group.leaderId === userId) return;
    const membership = await this.prisma.groupMembership.findFirst({
      where: { groupId: group.id, userId, leftAt: null },
    });
    if (!membership) {
      throw new BadRequestException('La persona no pertenece a este grupo.');
    }
  }

  /** Arma el modelo filtrando asistencia y entregas según el rol del que consulta. */
  private toModel(row: SessionRow, me: AuthenticatedUser, privileged: boolean): GroupSessionModel {
    return {
      id: row.id,
      group: toGroupModel(row.group),
      scheduledFor: row.scheduledFor,
      startsAt: row.startsAt,
      status: row.status,
      title: row.title,
      note: row.note,
      lesson: row.lesson
        ? {
            id: row.lesson.id,
            order: row.lesson.order,
            title: row.lesson.title,
            description: row.lesson.description,
            topic: {
              id: row.lesson.topic.id,
              order: row.lesson.topic.order,
              title: row.lesson.topic.title,
            },
          }
        : null,
      materials: row.materials.map((m) => this.toMaterial(m)),
      assignments: row.assignments.map((assignment) => {
        const mine = assignment.submissions.find((s) => s.userId === me.sub) ?? null;
        const visible = privileged
          ? assignment.submissions
          : assignment.submissions.filter((s) => s.userId === me.sub);
        return {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          dueAt: assignment.dueAt,
          createdAt: assignment.createdAt,
          submissions: visible.map((s) => this.toSubmission(s)),
          mySubmission: mine ? this.toSubmission(mine) : null,
        };
      }),
      attendances: (privileged
        ? row.attendances
        : row.attendances.filter((a) => a.userId === me.sub)
      ).map((a) => this.toAttendance(a)),
    };
  }

  private toMaterial(row: SessionMaterial & { uploadedBy: User }): SessionMaterialModel {
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      uploadedBy: toUserModel(row.uploadedBy),
      createdAt: row.createdAt,
    };
  }

  private toSubmission(row: AssignmentSubmission & { user: User }): SubmissionModel {
    return { id: row.id, user: toUserModel(row.user), url: row.url, submittedAt: row.submittedAt };
  }

  private toAttendance(row: SessionAttendance & { user: User }): AttendanceModel {
    return { id: row.id, user: toUserModel(row.user), checkedInAt: row.checkedInAt };
  }
}
