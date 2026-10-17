import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InstituteAttachment,
  InstituteItem,
  InstituteRole,
  InstituteSubmission,
  Prisma,
  User,
} from '@prisma/client';
import { z } from 'zod';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { VideoProcessingService } from '../media/video-processing.service';
import { PrismaService } from '../prisma/prisma.service';
import { toUserModel } from '../users/dto/to-user-model';
import { InstituteItemStatus } from './dto/institute-enums';
import {
  InstituteAccessModel,
  InstituteCalendarEntryModel,
  InstituteCalendarEntryType,
  InstituteClassModel,
  FormGradesImportModel,
  InstituteEnrollmentModel,
  InstituteGradebookModel,
  InstituteItemModel,
  InstituteModuleModel,
  InstituteSubmissionModel,
} from './dto/institute.models';

const mediaUrl = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((u) => u.startsWith('/uploads/') || /^https?:\/\//.test(u), 'URL inválida');

const moduleSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullish(),
});

const itemSchema = z
  .object({
    moduleId: z.string().min(1),
    kind: z.enum(['MATERIAL', 'ASSIGNMENT', 'EXAM']),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10000).nullish(),
    maxPoints: z.number().int().min(1).max(1000).nullish(),
    dueAt: z.coerce.date().nullish(),
    publishAt: z.coerce.date().nullish(),
    attachments: z
      .array(
        z.object({
          kind: z.enum(['FILE', 'LINK', 'YOUTUBE', 'FORM']),
          title: z.string().trim().min(1).max(200),
          url: mediaUrl,
          mimeType: z.string().max(200).nullish(),
        }),
      )
      .max(20)
      .default([]),
  })
  // Un material no se entrega ni se califica.
  .transform((d) => (d.kind === 'MATERIAL' ? { ...d, maxPoints: null, dueAt: null } : d));

const classSchema = z
  .object({
    moduleId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullish(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullish(),
    location: z.string().trim().max(200).nullish(),
    meetingUrl: z
      .string()
      .trim()
      .max(1000)
      .refine((u) => /^https?:\/\//.test(u), 'El enlace tiene que empezar por https://')
      .nullish()
      .or(z.literal('').transform(() => null)),
  })
  .refine((d) => !d.endsAt || d.endsAt > d.startsAt, {
    message: 'La clase tiene que terminar después de empezar.',
    path: ['endsAt'],
  });

const formGradesSchema = z.object({
  itemId: z.string().min(1),
  responses: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        score: z.number().min(0),
        submittedAt: z.coerce.date().nullish(),
      }),
    )
    .max(5000),
  formTotal: z.number().positive(),
  returnToStudent: z.boolean(),
  overwriteReturned: z.boolean(),
  apply: z.boolean(),
});

const gradeSchema = z.object({
  itemId: z.string().min(1),
  studentId: z.string().min(1),
  grade: z.number().min(0).max(1000).nullish(),
  returnToStudent: z.boolean(),
});

type ItemRow = InstituteItem & { author: User; attachments: InstituteAttachment[] };
type Access = { role: InstituteRole | null; isPastor: boolean };

const ITEM_INCLUDE = {
  author: true,
  attachments: { orderBy: { position: 'asc' as const } },
};

function statusOf(item: Pick<InstituteItem, 'publishAt'>, now = new Date()): InstituteItemStatus {
  if (!item.publishAt) return InstituteItemStatus.DRAFT;
  return item.publishAt > now ? InstituteItemStatus.SCHEDULED : InstituteItemStatus.PUBLISHED;
}

/**
 * El Instituto Bíblico. Lo administran profesores y pastores; los alumnos ven
 * lo publicado (no los borradores ni lo programado), marcan sus entregas y ven
 * sus notas devueltas. Solo los pastores nombran profesores.
 */
@Injectable()
export class InstituteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly video: VideoProcessingService,
  ) {}

  private async accessOf(me: AuthenticatedUser): Promise<Access> {
    const enrollment = await this.prisma.instituteEnrollment.findFirst({
      where: { userId: me.sub, leftAt: null },
    });
    return { role: enrollment?.role ?? null, isPastor: me.isPastor };
  }

  async access(me: AuthenticatedUser): Promise<InstituteAccessModel> {
    const a = await this.accessOf(me);
    const canManage = a.isPastor || a.role === 'TEACHER';
    return { role: a.role, canManage, canView: canManage || a.role === 'STUDENT' };
  }

  private async assertView(me: AuthenticatedUser): Promise<Access> {
    const a = await this.accessOf(me);
    if (!a.isPastor && !a.role) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'El Instituto Bíblico es para sus alumnos, profesores y los pastores.',
      });
    }
    return a;
  }

  private async assertManage(me: AuthenticatedUser): Promise<Access> {
    const a = await this.assertView(me);
    if (!a.isPastor && a.role !== 'TEACHER') {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo los profesores y los pastores pueden hacer esto.',
      });
    }
    return a;
  }

  private toItem(
    item: ItemRow,
    extra: Pick<InstituteItemModel, 'mySubmission' | 'turnedInCount'> = {},
  ): InstituteItemModel {
    return {
      id: item.id,
      moduleId: item.moduleId,
      kind: item.kind,
      title: item.title,
      description: item.description,
      maxPoints: item.maxPoints,
      dueAt: item.dueAt,
      publishAt: item.publishAt,
      status: statusOf(item),
      author: toUserModel(item.author),
      attachments: item.attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        title: a.title,
        url: a.url,
        mimeType: a.mimeType,
      })),
      createdAt: item.createdAt,
      ...extra,
    };
  }

  /** Los módulos con sus publicaciones; a los alumnos solo lo publicado. */
  async modules(me: AuthenticatedUser): Promise<InstituteModuleModel[]> {
    const a = await this.assertView(me);
    const manager = a.isPastor || a.role === 'TEACHER';
    const now = new Date();
    const modules = await this.prisma.instituteModule.findMany({
      where: { archivedAt: null },
      orderBy: { order: 'asc' },
      include: {
        items: {
          where: { deletedAt: null, ...(manager ? {} : { publishAt: { lte: now } }) },
          orderBy: [{ publishAt: 'desc' }, { createdAt: 'desc' }],
          include: ITEM_INCLUDE,
        },
      },
    });

    const itemIds = modules.flatMap((m) => m.items.map((i) => i.id));
    const mine = manager
      ? []
      : await this.prisma.instituteSubmission.findMany({
          where: { studentId: me.sub, itemId: { in: itemIds } },
        });
    const mineById = new Map(mine.map((s) => [s.itemId, s]));
    const counts = manager
      ? await this.prisma.instituteSubmission.groupBy({
          by: ['itemId'],
          where: {
            itemId: { in: itemIds },
            OR: [{ state: { not: null } }, { grade: { not: null } }],
          },
          _count: true,
        })
      : [];
    const countById = new Map(counts.map((c) => [c.itemId, c._count]));

    return modules.map((m) => ({
      id: m.id,
      order: m.order,
      title: m.title,
      description: m.description,
      items: m.items.map((item) =>
        this.toItem(
          item,
          manager
            ? { turnedInCount: countById.get(item.id) ?? 0 }
            : { mySubmission: this.mySubmission(mineById.get(item.id)) },
        ),
      ),
    }));
  }

  private mySubmission(s: InstituteSubmission | undefined) {
    if (!s) return { state: null, turnedInAt: null, late: false, grade: null };
    return { state: s.state, turnedInAt: s.turnedInAt, late: s.late, grade: s.grade };
  }

  async createModule(me: AuthenticatedUser, raw: unknown): Promise<InstituteModuleModel> {
    await this.assertManage(me);
    const data = moduleSchema.parse(raw);
    const last = await this.prisma.instituteModule.findFirst({ orderBy: { order: 'desc' } });
    const m = await this.prisma.instituteModule.create({
      data: { ...data, order: (last?.order ?? -1) + 1 },
    });
    return { id: m.id, order: m.order, title: m.title, description: m.description, items: [] };
  }

  async updateModule(
    me: AuthenticatedUser,
    id: string,
    raw: unknown,
  ): Promise<InstituteModuleModel> {
    await this.assertManage(me);
    const data = moduleSchema.parse(raw);
    const m = await this.prisma.instituteModule.update({ where: { id }, data });
    return { id: m.id, order: m.order, title: m.title, description: m.description, items: [] };
  }

  async saveItem(
    me: AuthenticatedUser,
    id: string | null,
    raw: unknown,
  ): Promise<InstituteItemModel> {
    await this.assertManage(me);
    const data = itemSchema.parse(raw);
    const module = await this.prisma.instituteModule.findFirst({
      where: { id: data.moduleId, archivedAt: null },
    });
    if (!module) throw new NotFoundException(`Module ${data.moduleId} not found.`);
    const { attachments, ...fields } = data;
    const attachmentRows = attachments.map((a, position) => ({ ...a, position }));

    const item = await this.prisma.$transaction(async (tx) => {
      if (!id) {
        return tx.instituteItem.create({
          data: { ...fields, authorId: me.sub, attachments: { create: attachmentRows } },
          include: ITEM_INCLUDE,
        });
      }
      const existing = await tx.instituteItem.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException(`Item ${id} not found.`);
      await tx.instituteAttachment.deleteMany({ where: { itemId: id } });
      return tx.instituteItem.update({
        where: { id },
        data: { ...fields, attachments: { create: attachmentRows } },
        include: ITEM_INCLUDE,
      });
    });
    // Los videos subidos se pasan a HLS por detrás para que arranquen rápido.
    this.video.enqueue(attachments.filter((a) => a.kind === 'FILE').map((a) => a.url));
    return this.toItem(item, { turnedInCount: 0 });
  }

  async deleteItem(me: AuthenticatedUser, id: string): Promise<boolean> {
    await this.assertManage(me);
    await this.prisma.instituteItem.update({ where: { id }, data: { deletedAt: new Date() } });
    return true;
  }

  /** Todos los alumnos con su entrega (o sin ella) para una tarea. Profesores. */
  async submissions(me: AuthenticatedUser, itemId: string): Promise<InstituteSubmissionModel[]> {
    await this.assertManage(me);
    const [students, rows] = await Promise.all([
      this.prisma.instituteEnrollment.findMany({
        where: { role: 'STUDENT', leftAt: null, user: { deletedAt: null } },
        include: { user: true },
      }),
      this.prisma.instituteSubmission.findMany({ where: { itemId } }),
    ]);
    const byStudent = new Map(rows.map((r) => [r.studentId, r]));
    return students
      .sort((a, b) =>
        `${a.user.firstName} ${a.user.lastName}`.localeCompare(
          `${b.user.firstName} ${b.user.lastName}`,
          'es',
        ),
      )
      .map(({ user }) => {
        const s = byStudent.get(user.id);
        return {
          student: toUserModel(user),
          state: s?.state ?? null,
          turnedInAt: s?.turnedInAt ?? null,
          late: s?.late ?? false,
          grade: s?.grade ?? null,
          draftGrade: s?.draftGrade ?? null,
        };
      });
  }

  /** El alumno marca la tarea como entregada (o la retira con turnIn=false). */
  async turnIn(
    me: AuthenticatedUser,
    itemId: string,
    turnIn: boolean,
  ): Promise<InstituteItemModel> {
    const a = await this.assertView(me);
    if (a.role !== 'STUDENT') {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'Solo los alumnos entregan.' });
    }
    const item = await this.prisma.instituteItem.findFirst({
      where: { id: itemId, deletedAt: null, publishAt: { lte: new Date() } },
      include: ITEM_INCLUDE,
    });
    if (!item) throw new NotFoundException(`Item ${itemId} not found.`);
    if (item.kind === 'MATERIAL') {
      throw new BadRequestException('Un material no se entrega.');
    }
    const existing = await this.prisma.instituteSubmission.findUnique({
      where: { itemId_studentId: { itemId, studentId: me.sub } },
    });
    if (existing?.state === 'RETURNED') {
      throw new BadRequestException('Esta tarea ya fue calificada.');
    }
    const now = new Date();
    const data = turnIn
      ? {
          state: 'TURNED_IN' as const,
          turnedInAt: now,
          late: Boolean(item.dueAt && now > item.dueAt),
        }
      : { state: null, turnedInAt: null, late: false };
    const saved = await this.prisma.instituteSubmission.upsert({
      where: { itemId_studentId: { itemId, studentId: me.sub } },
      create: { itemId, studentId: me.sub, ...data },
      update: data,
    });
    return this.toItem(item, { mySubmission: this.mySubmission(saved) });
  }

  /**
   * Poner una nota. Con returnToStudent el alumno la ve (y la tarea queda
   * devuelta); si no, queda como borrador que solo ven los profesores.
   */
  async grade(me: AuthenticatedUser, raw: unknown): Promise<InstituteSubmissionModel> {
    await this.assertManage(me);
    const { itemId, studentId, grade, returnToStudent } = gradeSchema.parse(raw);
    const item = await this.prisma.instituteItem.findFirst({
      where: { id: itemId, deletedAt: null },
    });
    if (!item) throw new NotFoundException(`Item ${itemId} not found.`);
    if (item.kind === 'MATERIAL') throw new BadRequestException('Un material no se califica.');
    if (grade != null && item.maxPoints != null && grade > item.maxPoints) {
      throw new BadRequestException(`La nota máxima es ${item.maxPoints}.`);
    }
    const student = await this.prisma.instituteEnrollment.findFirst({
      where: { userId: studentId, role: 'STUDENT', leftAt: null },
      include: { user: true },
    });
    if (!student) throw new NotFoundException('Esa persona no es alumna del instituto.');

    const data: Prisma.InstituteSubmissionUncheckedUpdateInput = returnToStudent
      ? {
          grade: grade ?? null,
          draftGrade: null,
          state: grade == null ? undefined : 'RETURNED',
          gradedById: me.sub,
          gradedAt: new Date(),
        }
      : { draftGrade: grade ?? null };
    const saved = await this.prisma.instituteSubmission.upsert({
      where: { itemId_studentId: { itemId, studentId } },
      create: {
        ...(data as Omit<Prisma.InstituteSubmissionUncheckedCreateInput, 'itemId' | 'studentId'>),
        itemId,
        studentId,
      },
      update: data,
    });
    return {
      student: toUserModel(student.user),
      state: saved.state,
      turnedInAt: saved.turnedInAt,
      late: saved.late,
      grade: saved.grade,
      draftGrade: saved.draftGrade,
    };
  }

  async roster(me: AuthenticatedUser): Promise<InstituteEnrollmentModel[]> {
    await this.assertManage(me);
    const rows = await this.prisma.instituteEnrollment.findMany({
      where: { leftAt: null, user: { deletedAt: null } },
      include: { user: true },
    });
    return rows
      .map((r) => ({ id: r.id, role: r.role, user: toUserModel(r.user), createdAt: r.createdAt }))
      .sort((a, b) => a.user.fullName.localeCompare(b.user.fullName, 'es'));
  }

  /** Inscribir alumnos (profesores y pastores) o nombrar profesores (solo pastores). */
  async enroll(
    me: AuthenticatedUser,
    userIds: string[],
    role: InstituteRole,
  ): Promise<InstituteEnrollmentModel[]> {
    const a = await this.assertManage(me);
    if (role === 'TEACHER' && !a.isPastor) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo los pastores nombran profesores.',
      });
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, deletedAt: null },
    });
    if (users.length !== new Set(userIds).size)
      throw new NotFoundException('Alguna persona no existe.');
    for (const user of users) {
      await this.prisma.instituteEnrollment.upsert({
        where: { userId: user.id },
        create: { userId: user.id, role },
        update: { role, leftAt: null },
      });
    }
    const rows = await this.prisma.instituteEnrollment.findMany({
      where: { userId: { in: userIds } },
      include: { user: true },
    });
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      user: toUserModel(r.user),
      createdAt: r.createdAt,
    }));
  }

  async unenroll(me: AuthenticatedUser, enrollmentId: string): Promise<boolean> {
    const a = await this.assertManage(me);
    const row = await this.prisma.instituteEnrollment.findUnique({ where: { id: enrollmentId } });
    if (!row) throw new NotFoundException(`Enrollment ${enrollmentId} not found.`);
    if (row.role === 'TEACHER' && !a.isPastor) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo los pastores sacan a un profesor.',
      });
    }
    await this.prisma.instituteEnrollment.update({
      where: { id: enrollmentId },
      data: { leftAt: new Date() },
    });
    return true;
  }

  /** Todas las notas: una fila por alumno, una columna por tarea o examen. */
  async gradebook(me: AuthenticatedUser): Promise<InstituteGradebookModel> {
    await this.assertManage(me);
    const items = await this.prisma.instituteItem.findMany({
      where: { deletedAt: null, kind: { not: 'MATERIAL' }, module: { archivedAt: null } },
      include: { ...ITEM_INCLUDE, module: true },
      orderBy: [{ createdAt: 'asc' }],
    });
    items.sort((a, b) => a.module.order - b.module.order);
    const [students, subs] = await Promise.all([
      this.prisma.instituteEnrollment.findMany({
        where: { role: 'STUDENT', leftAt: null, user: { deletedAt: null } },
        include: { user: true },
      }),
      this.prisma.instituteSubmission.findMany({
        where: { itemId: { in: items.map((i) => i.id) } },
      }),
    ]);
    const byStudent = new Map<string, InstituteSubmission[]>();
    for (const s of subs) byStudent.set(s.studentId, [...(byStudent.get(s.studentId) ?? []), s]);
    return {
      items: items.map((i) => this.toItem(i)),
      rows: students
        .map(({ user }) => ({
          student: toUserModel(user),
          cells: (byStudent.get(user.id) ?? []).map((s) => ({
            itemId: s.itemId,
            state: s.state,
            grade: s.grade,
            draftGrade: s.draftGrade,
            late: s.late,
          })),
        }))
        .sort((a, b) => a.student.fullName.localeCompare(b.student.fullName, 'es')),
    };
  }

  /** Las clases programadas (pasadas y futuras), las más próximas primero. */
  async classes(me: AuthenticatedUser): Promise<InstituteClassModel[]> {
    await this.assertView(me);
    const rows = await this.prisma.instituteClass.findMany({
      where: { deletedAt: null, module: { archivedAt: null } },
      include: { module: true },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((c) => this.toClass(c));
  }

  private toClass(c: {
    id: string;
    moduleId: string;
    module: { title: string };
    title: string;
    description: string | null;
    startsAt: Date;
    endsAt: Date | null;
    location: string | null;
    meetingUrl: string | null;
  }): InstituteClassModel {
    return {
      id: c.id,
      moduleId: c.moduleId,
      moduleTitle: c.module.title,
      title: c.title,
      description: c.description,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      location: c.location,
      meetingUrl: c.meetingUrl,
    };
  }

  async saveClass(
    me: AuthenticatedUser,
    id: string | null,
    raw: unknown,
  ): Promise<InstituteClassModel> {
    await this.assertManage(me);
    const data = classSchema.parse(raw);
    const module = await this.prisma.instituteModule.findFirst({
      where: { id: data.moduleId, archivedAt: null },
    });
    if (!module) throw new NotFoundException(`Module ${data.moduleId} not found.`);
    const row = id
      ? await this.prisma.instituteClass.update({ where: { id }, data, include: { module: true } })
      : await this.prisma.instituteClass.create({
          data: { ...data, createdById: me.sub },
          include: { module: true },
        });
    return this.toClass(row);
  }

  async deleteClass(me: AuthenticatedUser, id: string): Promise<boolean> {
    await this.assertManage(me);
    await this.prisma.instituteClass.update({ where: { id }, data: { deletedAt: new Date() } });
    return true;
  }

  /**
   * Lo del instituto para el calendario de la iglesia: clases programadas y
   * fechas límite de tareas y exámenes. A quien no está inscrito no le
   * devuelve nada (no es un error: el calendario es de todos).
   */
  async calendar(
    me: AuthenticatedUser,
    from: Date,
    to: Date,
  ): Promise<InstituteCalendarEntryModel[]> {
    const a = await this.accessOf(me);
    const manager = a.isPastor || a.role === 'TEACHER';
    if (!manager && a.role !== 'STUDENT') return [];
    const now = new Date();

    const [classes, items] = await Promise.all([
      this.prisma.instituteClass.findMany({
        where: { deletedAt: null, startsAt: { gte: from, lte: to }, module: { archivedAt: null } },
        include: { module: true },
      }),
      this.prisma.instituteItem.findMany({
        where: {
          deletedAt: null,
          kind: { not: 'MATERIAL' },
          dueAt: { gte: from, lte: to },
          module: { archivedAt: null },
          // Los alumnos no ven lo que todavía no se publica.
          ...(manager ? { publishAt: { not: null } } : { publishAt: { lte: now } }),
        },
        include: {
          module: true,
          submissions: manager ? false : { where: { studentId: me.sub } },
        },
      }),
    ]);

    return [
      ...classes.map((c) => ({
        id: c.id,
        type: InstituteCalendarEntryType.CLASS,
        title: c.title,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        moduleTitle: c.module.title,
        itemKind: null,
        location: c.location,
        meetingUrl: c.meetingUrl,
        done: false,
      })),
      ...items.map((i) => {
        const mine = (i as { submissions?: InstituteSubmission[] }).submissions?.[0];
        return {
          id: i.id,
          type: InstituteCalendarEntryType.DEADLINE,
          title: i.title,
          startsAt: i.dueAt!,
          endsAt: null,
          moduleTitle: i.module.title,
          itemKind: i.kind,
          location: null,
          meetingUrl: null,
          done: Boolean(mine && (mine.state || mine.grade != null)),
        };
      }),
    ];
  }

  /**
   * Notas de un examen en Google Forms (el navegador del profesor las lee con
   * su permiso y las manda aquí). Se cruzan por correo con los alumnos; si un
   * correo respondió varias veces cuenta la última respuesta. Responder cuenta
   * como entregar. Sin `apply` es solo vista previa.
   */
  async importFormGrades(me: AuthenticatedUser, raw: unknown): Promise<FormGradesImportModel> {
    await this.assertManage(me);
    const data = formGradesSchema.parse(raw);
    const item = await this.prisma.instituteItem.findFirst({
      where: { id: data.itemId, deletedAt: null },
    });
    if (!item) throw new NotFoundException(`Item ${data.itemId} not found.`);
    if (item.kind === 'MATERIAL') throw new BadRequestException('Un material no se califica.');

    // Una respuesta por correo: la última.
    const latest = new Map<string, (typeof data.responses)[number]>();
    for (const r of data.responses) {
      const prev = latest.get(r.email);
      const newer = !prev || (r.submittedAt?.getTime() ?? 0) >= (prev.submittedAt?.getTime() ?? 0);
      if (newer) latest.set(r.email, r);
    }

    const students = await this.prisma.instituteEnrollment.findMany({
      where: { role: 'STUDENT', leftAt: null, user: { deletedAt: null } },
      include: { user: true },
    });
    const byEmail = new Map(students.map((s) => [s.user.email.toLowerCase(), s.user]));
    const existing = await this.prisma.instituteSubmission.findMany({ where: { itemId: item.id } });
    const existingBy = new Map(existing.map((s) => [s.studentId, s]));

    // Si la tarea no tiene puntos, toma los del formulario; si tiene otros, se convierte.
    const maxPoints = item.maxPoints ?? data.formTotal;
    const scale = maxPoints / data.formTotal;
    const round = (n: number) => Math.round(n * 100) / 100;

    const unmatched: string[] = [];
    const writes: Array<{ studentId: string; grade: number; submittedAt: Date | null }> = [];
    let skippedReturned = 0;
    for (const [email, r] of latest) {
      const student = byEmail.get(email);
      if (!student) {
        unmatched.push(email);
        continue;
      }
      const prev = existingBy.get(student.id);
      if (prev?.grade != null && !data.overwriteReturned) {
        skippedReturned += 1;
        continue;
      }
      writes.push({
        studentId: student.id,
        grade: round(Math.min(r.score * scale, maxPoints)),
        submittedAt: r.submittedAt ?? null,
      });
    }
    const matched = latest.size - unmatched.length;

    if (data.apply) {
      const now = new Date();
      await this.prisma.$transaction([
        ...(item.maxPoints == null
          ? [
              this.prisma.instituteItem.update({
                where: { id: item.id },
                data: { maxPoints: Math.round(maxPoints) },
              }),
            ]
          : []),
        ...writes.map((w) => {
          const prev = existingBy.get(w.studentId);
          const turnedIn = {
            // Responder el formulario es entregar.
            state: data.returnToStudent
              ? ('RETURNED' as const)
              : (prev?.state ?? ('TURNED_IN' as const)),
            turnedInAt: prev?.turnedInAt ?? w.submittedAt ?? now,
            late: prev?.late || Boolean(item.dueAt && w.submittedAt && w.submittedAt > item.dueAt),
          };
          const grades = data.returnToStudent
            ? { grade: w.grade, draftGrade: null, gradedById: me.sub, gradedAt: now }
            : { draftGrade: w.grade };
          return this.prisma.instituteSubmission.upsert({
            where: { itemId_studentId: { itemId: item.id, studentId: w.studentId } },
            create: { itemId: item.id, studentId: w.studentId, ...turnedIn, ...grades },
            update: { ...turnedIn, ...grades },
          });
        }),
      ]);
    }

    return {
      responses: latest.size,
      matched,
      updated: writes.length,
      skippedReturned,
      unmatched: unmatched.sort(),
      missing: students.length - matched,
      maxPoints,
      applied: data.apply,
    };
  }
}
