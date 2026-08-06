import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Event } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { createEventSchema, updateEventSchema } from './dto/inputs.schema';
import { EventRow } from './dto/to-event-model';
import { canSeeMembersOnly } from './event-visibility';

const EVENT_INCLUDE = { createdBy: true, group: { include: { leader: true } } } as const;

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(me: AuthenticatedUser, raw: unknown): Promise<EventRow> {
    const data = createEventSchema.parse(raw);

    if (!data.groupId) {
      if (!me.isPastor) {
        throw new ForbiddenException({
          error: 'FORBIDDEN',
          message: 'Solo un pastor puede crear eventos generales.',
        });
      }
    } else {
      const group = await this.prisma.group.findUnique({ where: { id: data.groupId } });
      if (!group) throw new NotFoundException(`Group ${data.groupId} not found.`);
      if (!me.isPastor && group.leaderId !== me.sub) {
        throw new ForbiddenException({
          error: 'FORBIDDEN',
          message: 'Solo el líder del grupo o un pastor puede crear eventos del grupo.',
        });
      }
    }

    return this.prisma.event.create({
      data: { ...data, createdById: me.sub },
      include: EVENT_INCLUDE,
    });
  }

  async updateById(me: AuthenticatedUser, id: string, raw: unknown): Promise<EventRow> {
    const data = updateEventSchema.parse(raw);
    await this.assertCreatorOrPastor(me, id);
    return this.prisma.event.update({ where: { id }, data, include: EVENT_INCLUDE });
  }

  async deleteById(me: AuthenticatedUser, id: string): Promise<EventRow> {
    const event = await this.assertCreatorOrPastor(me, id);
    // Detach feed posts that referenced it before deleting.
    await this.prisma.post.updateMany({ where: { eventId: id }, data: { eventId: null } });
    await this.prisma.event.delete({ where: { id } });
    return event;
  }

  /**
   * El calendario es agenda personal: eventos generales más los de grupos que
   * el usuario dicta o a los que asiste (también para pastores).
   *
   * Los eventos marcados `membersOnly` solo los ven miembros y pastores; para
   * un asistente es como si no existieran.
   */
  async listVisible(me: AuthenticatedUser, from: Date, to: Date): Promise<EventRow[]> {
    return this.prisma.event.findMany({
      where: {
        startsAt: { gte: from, lte: to },
        ...(canSeeMembersOnly(me) ? {} : { membersOnly: false }),
        OR: [
          { groupId: null },
          { group: { leaderId: me.sub } },
          { group: { memberships: { some: { userId: me.sub, leftAt: null } } } },
        ],
      },
      include: EVENT_INCLUDE,
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Eventos anunciados sin fecha todavía ("bautizos, fecha por confirmar"). El
   * calendario filtra por rango, así que estos nunca saldrían ahí: van aparte.
   * Misma regla de visibilidad que `listVisible`.
   */
  async listUndated(me: AuthenticatedUser): Promise<EventRow[]> {
    return this.prisma.event.findMany({
      where: {
        startsAt: null,
        ...(canSeeMembersOnly(me) ? {} : { membersOnly: false }),
        OR: [
          { groupId: null },
          { group: { leaderId: me.sub } },
          { group: { memberships: { some: { userId: me.sub, leftAt: null } } } },
        ],
      },
      include: EVENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertCreatorOrPastor(me: AuthenticatedUser, id: string): Promise<EventRow> {
    const event = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });
    if (!event) throw new NotFoundException(`Event ${id} not found.`);
    if (!me.isPastor && event.createdById !== me.sub) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo quien creó el evento o un pastor puede modificarlo.',
      });
    }
    return event;
  }

  /**
   * Los eventos que puede leer cualquiera desde el sitio web, sin sesión.
   *
   * Tres filtros, y los tres importan:
   *   - `membersOnly: false` — la marca que ya usaba `listVisible` para los
   *     asistentes; aquí es innegociable porque no hay usuario que evaluar.
   *   - `groupId: null` — un evento de grupo es interno por naturaleza aunque
   *     nadie lo marcara como de miembros. La web anuncia lo general.
   *   - `startsAt` con fecha y dentro del rango — sin fecha no se publica.
   *
   * No lleva `include`: quien llama recibe `PublicEventModel`, que es sólo
   * escalares. Traer el `createdBy` o el `group` sería cargar a memoria datos
   * que no deben salir de aquí.
   */
  async listPublic(from: Date, to: Date): Promise<Event[]> {
    return this.prisma.event.findMany({
      where: {
        membersOnly: false,
        groupId: null,
        startsAt: { gte: from, lte: to },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

}
