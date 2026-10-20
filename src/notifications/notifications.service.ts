import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decodeCursor } from '../common/pagination/encode-cursor';
import { PaginationInput } from '../common/pagination/pagination.input';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from './catalog';
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

  constructor(private readonly prisma: PrismaService) {}

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
      await this.prisma.notification.createMany({
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
            })),
        ),
      });
    } catch (e) {
      const types = [...new Set(inputs.map((i) => i.type))].join(', ');
      this.logger.error(`No se pudo crear el aviso ${types}`, e as Error);
    }
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
