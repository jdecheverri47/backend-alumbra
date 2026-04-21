import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Ministry, MinistryMembership, MinistryRole, Prisma } from '@prisma/client';
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

  async findBySlug(slug: string, opts: { includeArchived?: boolean } = {}): Promise<Ministry | null> {
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
  ): Promise<MinistryMembership[]> {
    return this.prisma.ministryMembership.findMany({
      where: {
        ministryId,
        ...(opts.role ? { role: opts.role } : {}),
        ...(opts.includeLeft ? {} : { leftAt: null }),
      },
      orderBy: { joinedAt: 'desc' },
    });
  }
}
