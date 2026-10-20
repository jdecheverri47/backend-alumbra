import { Injectable, Logger } from '@nestjs/common';
import { formatWhen } from '../common/format-date';
import { contentNotice } from '../institute/institute-notices';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService, NotifyInput } from './notifications.service';

const HOUR = 60 * 60 * 1000;
/** Cuánto antes se recuerda una fecha límite, una clase o un evento. */
export const REMINDER_AHEAD = 24 * HOUR;
/**
 * Lo programado se avisa si se publicó hace menos de esto. Así, si el
 * programador estuvo caído un rato, se pone al día, pero al encenderlo por
 * primera vez no avisa de todo lo viejo.
 */
const PUBLISHED_LOOKBACK = 48 * HOUR;

type Notice = NotifyInput & { data: { refId: string } };

export interface TickResult {
  published: number;
  dueSoon: number;
  classes: number;
  events: number;
}

const place = (when: Date, location: string | null) =>
  location ? `${formatWhen(when)} · ${location}` : formatWhen(when);

/**
 * Los avisos que no salen de una acción de alguien sino de la hora: lo
 * programado que ya se publicó y lo que viene en las próximas 24 horas. Lo
 * dispara Cloud Scheduler cada 15 minutos; cada aviso sale una sola vez.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async tick(now = new Date()): Promise<TickResult> {
    const students = (
      await this.prisma.instituteEnrollment.findMany({
        where: { role: 'STUDENT', leftAt: null },
        select: { userId: true },
      })
    ).map((s) => s.userId);

    const result: TickResult = {
      published: await this.notifications.notifyEachOnce(await this.published(now, students)),
      dueSoon: await this.notifications.notifyEachOnce(await this.dueSoon(now, students)),
      classes: await this.notifications.notifyEachOnce(await this.classes(now, students)),
      events: await this.notifications.notifyEachOnce(await this.events(now)),
    };
    this.logger.log(`Recordatorios: ${JSON.stringify(result)}`);
    return result;
  }

  /** Lo que estaba programado y ya llegó su hora. */
  private async published(now: Date, students: string[]): Promise<Notice[]> {
    const items = await this.prisma.instituteItem.findMany({
      where: {
        deletedAt: null,
        module: { archivedAt: null },
        publishAt: { lte: now, gt: new Date(now.getTime() - PUBLISHED_LOOKBACK) },
      },
      include: { module: true },
    });
    return items.map(
      (item) => contentNotice(item, item.module.title, students, item.authorId) as Notice,
    );
  }

  /** Tareas y exámenes que vencen en las próximas 24 h, a quien no ha entregado. */
  private async dueSoon(now: Date, students: string[]): Promise<Notice[]> {
    const items = await this.prisma.instituteItem.findMany({
      where: {
        deletedAt: null,
        kind: { not: 'MATERIAL' },
        module: { archivedAt: null },
        publishAt: { lte: now },
        dueAt: { gt: now, lte: new Date(now.getTime() + REMINDER_AHEAD) },
      },
      include: { submissions: { where: { state: { not: null } }, select: { studentId: true } } },
    });
    return items.map((item) => {
      const done = new Set(item.submissions.map((s) => s.studentId));
      return {
        type: 'instituto.fecha.proxima',
        to: students.filter((id) => !done.has(id)),
        title: `Vence pronto: ${item.title}`,
        body: `Entrega hasta el ${formatWhen(item.dueAt!)}`,
        href: `/instituto?item=${item.id}`,
        data: { refId: item.id },
      };
    });
  }

  /** Clases del Instituto en las próximas 24 h, a alumnos y profesores. */
  private async classes(now: Date, students: string[]): Promise<Notice[]> {
    const [rows, teachers] = await Promise.all([
      this.prisma.instituteClass.findMany({
        where: {
          deletedAt: null,
          module: { archivedAt: null },
          startsAt: { gt: now, lte: new Date(now.getTime() + REMINDER_AHEAD) },
        },
      }),
      this.prisma.instituteEnrollment.findMany({
        where: { role: 'TEACHER', leftAt: null },
        select: { userId: true },
      }),
    ]);
    const to = [...students, ...teachers.map((t) => t.userId)];
    return rows.map((c) => ({
      type: 'instituto.clase.proxima',
      to,
      title: `Clase: ${c.title}`,
      body: place(c.startsAt, c.location),
      href: '/instituto',
      data: { refId: c.id },
    }));
  }

  /**
   * Eventos del calendario en las próximas 24 h, a quien los ve: los de un
   * grupo, a su líder y sus integrantes; los generales, a toda la iglesia (o
   * solo a los miembros si son para miembros).
   */
  private async events(now: Date): Promise<Notice[]> {
    const rows = await this.prisma.event.findMany({
      where: { startsAt: { gt: now, lte: new Date(now.getTime() + REMINDER_AHEAD) } },
      include: {
        group: {
          include: { memberships: { where: { leftAt: null }, select: { userId: true } } },
        },
      },
    });
    const everyone = new Map<boolean, string[]>();
    const audience = async (membersOnly: boolean) => {
      if (!everyone.has(membersOnly)) {
        everyone.set(membersOnly, await this.notifications.audience(membersOnly));
      }
      return everyone.get(membersOnly)!;
    };

    const notices: Notice[] = [];
    for (const e of rows) {
      let to: string[];
      if (e.group) {
        if (e.group.archivedAt) continue;
        to = [e.group.leaderId, ...e.group.memberships.map((m) => m.userId)];
        if (e.membersOnly) {
          const members = new Set(await audience(true));
          to = to.filter((id) => members.has(id));
        }
      } else {
        to = await audience(e.membersOnly);
      }
      notices.push({
        type: 'calendario.evento.proximo',
        to,
        title: `${e.title}${e.group ? ` · ${e.group.name}` : ''}`,
        body: place(e.startsAt!, e.location),
        href: '/calendario',
        data: { refId: e.id },
      });
    }
    return notices;
  }
}
