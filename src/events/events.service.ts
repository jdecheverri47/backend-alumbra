import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { createEventSchema, updateEventSchema } from './dto/inputs.schema';
import { EventRow } from './dto/to-event-model';

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
   * Events visible to the user within [from, to]: general events plus events
   * of groups the user leads or belongs to. Pastors see everything.
   */
  async listVisible(me: AuthenticatedUser, from: Date, to: Date): Promise<EventRow[]> {
    const visibility = me.isPastor
      ? {}
      : {
          OR: [
            { groupId: null },
            { group: { leaderId: me.sub } },
            { group: { memberships: { some: { userId: me.sub, leftAt: null } } } },
          ],
        };
    return this.prisma.event.findMany({
      where: { startsAt: { gte: from, lte: to }, ...visibility },
      include: EVENT_INCLUDE,
      orderBy: { startsAt: 'asc' },
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
}
