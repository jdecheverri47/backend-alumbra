import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decodeCursor } from '../common/pagination/encode-cursor';
import { PaginationInput } from '../common/pagination/pagination.input';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATION_TYPES, NotificationType } from './catalog';
import { NotificationPreferenceModel } from './dto/notification-preference.model';
import { NotificationEmailService } from './email/notification-email.service';
import { NotificationConnection, toNotificationEdge } from './dto/notification.model';

export type NotificationResolution = 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface NotifyInput {
  type: NotificationType;
  /** Ids de las personas a avisar. Se quitan repetidos y al propio actor. */
  to: string[];
  title: string;
  body?: string | null;
  href?: string | null;
  actorId?: string | null;
  data?: Prisma.InputJsonValue;
}

const MAX_PAGE = 50;

/** El comienzo de un texto largo, para el cuerpo de un aviso. */
export function excerpt(text: string | null | undefined, max = 140): string | null {
  const flat = text?.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Los avisos de la campana. Los demás módulos llaman a `notify` después de
 * guardar lo suyo: si el aviso falla se anota en el log, pero no tumba la
 * acción que lo provocó.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: NotificationEmailService,
  ) {}

  notify(input: NotifyInput): Promise<void> {
    return this.notifyEach([input]);
  }

  /**
   * Varios avisos distintos de una vez (p. ej. a cada alumno su nota): una
   * consulta y una escritura en total, no una por persona.
   */
  async notifyEach(inputs: NotifyInput[]): Promise<void> {
    const wanted = inputs.map((input) => ({
      input,
      ids: [...new Set(input.to)].filter((id) => id !== input.actorId),
    }));
    const allIds = [...new Set(wanted.flatMap((w) => w.ids))];
    if (allIds.length === 0) return;
    try {
      // Solo a quien puede entrar: un importado sin acceso no vería la campana.
      const reachable = new Set(
        (
          await this.prisma.user.findMany({
            where: { id: { in: allIds }, deletedAt: null, canSignIn: true },
            select: { id: true },
          })
        ).map((u) => u.id),
      );
      const types = [...new Set(inputs.map((i) => i.type))];
      const optedOut = await this.emailOptOuts([...reachable], types);
      const created = await this.prisma.notification.createManyAndReturn({
        select: { id: true, emailStatus: true },
        data: wanted.flatMap(({ input, ids }) =>
          ids
            .filter((id) => reachable.has(id))
            .map((userId) => ({
              userId,
              type: input.type,
              title: input.title,
              body: input.body ?? null,
              href: input.href ?? null,
              actorId: input.actorId ?? null,
              data: input.data,
              emailStatus: optedOut.has(`${userId}:${input.type}`)
                ? ('NONE' as const)
                : ('PENDING' as const),
            })),
        ),
      });
      // Los correos salen ya; los que fallen los reintentan los recordatorios.
      await this.email.sendPending(
        created.filter((n) => n.emailStatus === 'PENDING').map((n) => n.id),
      );
    } catch (e) {
      const types = [...new Set(inputs.map((i) => i.type))].join(', ');
      this.logger.error(`No se pudo crear el aviso ${types}`, e as Error);
    }
  }

  /**
   * "userId:type" de quien NO quiere ese tipo por correo: por el catálogo
   * (si no lo cambió) o porque lo apagó.
   */
  private async emailOptOuts(userIds: string[], types: NotificationType[]): Promise<Set<string>> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, type: { in: types } },
    });
    const chosen = new Map(prefs.map((p) => [`${p.userId}:${p.type}`, p.email]));
    const out = new Set<string>();
    for (const userId of userIds) {
      for (const type of types) {
        const key = `${userId}:${type}`;
        if (!(chosen.get(key) ?? NOTIFICATION_TYPES[type].email)) out.add(key);
      }
    }
    return out;
  }

  /** Qué correos recibe cada quien, tipo por tipo, en el orden del catálogo. */
  async preferences(userId: string): Promise<NotificationPreferenceModel[]> {
    const prefs = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const chosen = new Map(prefs.map((p) => [p.type, p.email]));
    return Object.entries(NOTIFICATION_TYPES).map(([type, def]) => ({
      type,
      module: def.module,
      label: def.label,
      email: chosen.get(type) ?? def.email,
      emailByDefault: def.email,
    }));
  }

  async setPreference(
    userId: string,
    type: string,
    email: boolean,
  ): Promise<NotificationPreferenceModel> {
    const def = NOTIFICATION_TYPES[type as NotificationType];
    if (!def) throw new BadRequestException(`Tipo de aviso desconocido: ${type}`);
    await this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, email },
      update: { email },
    });
    // Lo que quedó por mandar de ese tipo también respeta el cambio.
    if (!email) {
      await this.prisma.notification.updateMany({
        where: { userId, type, emailStatus: 'PENDING' },
        data: { emailStatus: 'NONE' },
      });
    }
    return { type, module: def.module, label: def.label, email, emailByDefault: def.email };
  }

  /**
   * Como `notifyEach`, pero sin repetir: a quien ya recibió un aviso de ese
   * tipo sobre lo mismo (`data.refId`) no se le vuelve a mandar. Es lo que deja
   * correr los recordatorios cada pocos minutos sin duplicar nada.
   */
  async notifyEachOnce(inputs: Array<NotifyInput & { data: { refId: string } }>): Promise<number> {
    if (inputs.length === 0) return 0;
    const sent = new Set<string>();
    for (const type of new Set(inputs.map((i) => i.type))) {
      const refIds = inputs.filter((i) => i.type === type).map((i) => i.data.refId);
      const rows = await this.prisma.$queryRaw<Array<{ userId: string; refId: string }>>`
        SELECT "userId", data->>'refId' AS "refId" FROM "Notification"
        WHERE type = ${type} AND data->>'refId' = ANY(${refIds})`;
      for (const r of rows) sent.add(`${type}:${r.userId}:${r.refId}`);
    }
    const pending = inputs
      .map((i) => ({
        ...i,
        to: i.to.filter((userId) => !sent.has(`${i.type}:${userId}:${i.data.refId}`)),
      }))
      .filter((i) => i.to.length > 0);
    await this.notifyEach(pending);
    return pending.reduce((n, i) => n + i.to.length, 0);
  }

  /**
   * Quienes ven algo publicado para toda la iglesia, o solo para miembros
   * (y pastores) si `membersOnly`.
   */
  async audience(membersOnly: boolean): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        canSignIn: true,
        ...(membersOnly ? { OR: [{ baseRole: 'MIEMBRO' }, { isPastor: true }] } : {}),
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Cierra los avisos que pedían una decisión (p. ej. aprobar una solicitud):
   * a todos los que la recibieron les queda quién la resolvió y cómo, y a quien
   * la resolvió se le marca leída.
   */
  async resolve(
    type: NotificationType,
    refId: string,
    resolution: NotificationResolution,
    actorId: string,
  ): Promise<void> {
    try {
      const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
      const patch = JSON.stringify({
        resolution,
        resolvedByName: actor ? `${actor.firstName} ${actor.lastName}` : null,
      });
      await this.prisma.$executeRaw`
        UPDATE "Notification"
        SET data = COALESCE(data, '{}'::jsonb) || ${patch}::jsonb,
            "readAt" = CASE WHEN "userId" = ${actorId} THEN COALESCE("readAt", now()) ELSE "readAt" END
        WHERE type = ${type} AND data->>'refId' = ${refId}`;
    } catch (e) {
      this.logger.error(`No se pudo cerrar el aviso ${type} ${refId}`, e as Error);
    }
  }

  async list(userId: string, page: PaginationInput): Promise<NotificationConnection> {
    const first = Math.min(Math.max(page.first, 1), MAX_PAGE);
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      include: { actor: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: first + 1,
      ...(page.after ? { cursor: { id: decodeCursor(page.after) }, skip: 1 } : {}),
    });
    const slice = rows.slice(0, first);
    return {
      edges: slice.map(toNotificationEdge),
      pageInfo: {
        hasNextPage: rows.length > first,
        endCursor: slice.length ? toNotificationEdge(slice[slice.length - 1]).cursor : null,
      },
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Marca leída una de las suyas; la de otra persona se ignora en silencio. */
  async markRead(userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return count > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }
}
