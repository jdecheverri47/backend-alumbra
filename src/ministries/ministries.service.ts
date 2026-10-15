import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Ministry, MinistryMembership, MinistryRole, Prisma, User } from '@prisma/client';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { createMinistrySchema, updateMinistrySchema } from './dto/inputs.schema';

@Injectable()
export class MinistriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(raw: unknown): Promise<Ministry> {
    const data = createMinistrySchema.parse(raw);
    try {
      return await this.prisma.ministry.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A ministry with slug "${data.slug}" already exists.`);
      }
      throw e;
    }
  }

  async updateById(id: string, raw: unknown): Promise<Ministry> {
    const data = updateMinistrySchema.parse(raw);
    await this.findByIdOrThrow(id);
    return this.prisma.ministry.update({ where: { id }, data });
  }

  async findBySlug(
    slug: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<Ministry | null> {
    const m = await this.prisma.ministry.findUnique({ where: { slug } });
    if (!m) return null;
    if (!opts.includeArchived && m.archivedAt) return null;
    return m;
  }

  async findById(id: string): Promise<Ministry | null> {
    return this.prisma.ministry.findUnique({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<Ministry> {
    const m = await this.findById(id);
    if (!m) throw new NotFoundException(`Ministry ${id} not found.`);
    return m;
  }

  async list(opts: { includeArchived?: boolean } = {}): Promise<Ministry[]> {
    return this.prisma.ministry.findMany({
      where: opts.includeArchived ? {} : { archivedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async archive(id: string): Promise<Ministry> {
    await this.findByIdOrThrow(id);
    return this.prisma.ministry.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async addMember(input: {
    userId: string;
    ministryId: string;
    role: MinistryRole;
  }): Promise<MinistryMembership> {
    const existingActive = await this.prisma.ministryMembership.findFirst({
      where: {
        userId: input.userId,
        ministryId: input.ministryId,
        leftAt: null,
      },
    });
    if (existingActive) {
      throw new ConflictException('User already has an active membership in this ministry.');
    }
    return this.prisma.ministryMembership.create({ data: input });
  }

  async removeMember(membershipId: string): Promise<MinistryMembership> {
    const m = await this.prisma.ministryMembership.findUnique({ where: { id: membershipId } });
    if (!m) throw new NotFoundException(`Membership ${membershipId} not found.`);
    if (m.leftAt) return m;
    return this.prisma.ministryMembership.update({
      where: { id: membershipId },
      data: { leftAt: new Date() },
    });
  }

  async listMembers(
    ministryId: string,
    opts: { role?: MinistryRole; includeLeft?: boolean } = {},
  ): Promise<Array<MinistryMembership & { user: User }>> {
    return this.prisma.ministryMembership.findMany({
      where: {
        ministryId,
        ...(opts.role ? { role: opts.role } : {}),
        ...(opts.includeLeft ? {} : { leftAt: null }),
        user: { deletedAt: null },
      },
      orderBy: { joinedAt: 'desc' },
      include: { user: true },
    });
  }

  /** El rol activo de `userId` en el ministerio, o null si no pertenece. */
  async roleOf(userId: string, ministryId: string): Promise<MinistryRole | null> {
    const m = await this.prisma.ministryMembership.findFirst({
      where: { userId, ministryId, leftAt: null },
      select: { role: true },
    });
    return m?.role ?? null;
  }

  /**
   * Ver un ministerio por dentro (su equipo, su módulo): pastores y quienes
   * pertenecen a él. Un miembro solo ve los ministerios en los que está.
   */
  async assertCanView(me: AuthenticatedUser, ministryId: string): Promise<void> {
    if (me.isPastor) return;
    if (await this.roleOf(me.sub, ministryId)) return;
    throw new ForbiddenException({
      error: 'FORBIDDEN',
      message: 'Solo los pastores y quienes sirven en este ministerio pueden verlo.',
    });
  }

  /** Los ministerios activos de un usuario, con su rol. */
  async membershipsOf(
    userId: string,
  ): Promise<Array<MinistryMembership & { ministry: Ministry; user: User }>> {
    return this.prisma.ministryMembership.findMany({
      where: { userId, leftAt: null, ministry: { archivedAt: null } },
      include: { ministry: true, user: true },
      orderBy: { ministry: { name: 'asc' } },
    });
  }

  /**
   * Sumar a alguien a un ministerio. Lo hacen pastores y coordinadores del
   * ministerio (el guard ya lo comprobó); nombrar coordinadores es solo de
   * pastores. Solo sirven miembros: un asistente todavía no.
   */
  async assignMember(
    me: AuthenticatedUser,
    input: { userId: string; ministryId: string; role: MinistryRole },
  ): Promise<MinistryMembership> {
    if (input.role === 'LEADER' && !me.isPastor) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo los pastores nombran coordinadores.',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user || user.deletedAt) throw new NotFoundException(`User ${input.userId} not found.`);
    if (user.baseRole !== 'MIEMBRO' && !user.isPastor) {
      throw new BadRequestException({
        error: 'NOT_A_MEMBER',
        message: 'Solo los miembros de la iglesia pueden servir en un ministerio.',
      });
    }
    await this.findByIdOrThrow(input.ministryId);
    return this.addMember(input);
  }

  /** Coordinador o ministro. Solo pastores. */
  async setRole(membershipId: string, role: MinistryRole): Promise<MinistryMembership> {
    const m = await this.prisma.ministryMembership.findUnique({ where: { id: membershipId } });
    if (!m || m.leftAt) throw new NotFoundException(`Membership ${membershipId} not found.`);
    return this.prisma.ministryMembership.update({ where: { id: membershipId }, data: { role } });
  }

  /** Sacar a alguien del ministerio. A un coordinador solo lo saca un pastor. */
  async unassignMember(me: AuthenticatedUser, membershipId: string): Promise<MinistryMembership> {
    const m = await this.prisma.ministryMembership.findUnique({ where: { id: membershipId } });
    if (!m) throw new NotFoundException(`Membership ${membershipId} not found.`);
    if (m.role === 'LEADER' && !me.isPastor) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo los pastores pueden sacar a un coordinador.',
      });
    }
    return this.removeMember(membershipId);
  }
}
