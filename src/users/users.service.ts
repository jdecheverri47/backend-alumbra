import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationInput } from '../common/pagination/pagination.input';
import { decodeCursor, encodeCursor } from '../common/pagination/encode-cursor';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUserData,
  UpdateUserData,
  createUserSchema,
  updateUserSchema,
} from './dto/inputs.schema';
import { UserConnection } from './dto/user-connection.type';
import { UserFilterInput } from './dto/user-filter.input';

type UserRow = Prisma.UserGetPayload<Record<string, never>>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(raw: unknown): Promise<UserRow> {
    const data = createUserSchema.parse(raw) satisfies CreateUserData;
    try {
      return await this.prisma.user.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A user with email "${data.email}" already exists.`);
      }
      throw e;
    }
  }

  async findById(id: string): Promise<UserRow | null> {
    return this.prisma.user.findFirst({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<UserRow> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found.`);
    return user;
  }

  async updateById(id: string, raw: unknown): Promise<UserRow> {
    const data = updateUserSchema.parse(raw) satisfies UpdateUserData;
    await this.findByIdOrThrow(id);
    return this.prisma.user.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<UserRow> {
    await this.findByIdOrThrow(id);
    // Directly update deletedAt — honest and avoids the $queryRaw re-fetch hack.
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async setPastor(id: string, isPastor: boolean): Promise<UserRow> {
    await this.findByIdOrThrow(id);
    return this.prisma.user.update({ where: { id }, data: { isPastor } });
  }

  async list(filter: UserFilterInput, page: PaginationInput): Promise<UserConnection> {
    const take = page.first + 1; // fetch one extra to detect next page
    const where: Prisma.UserWhereInput = {};

    if (filter.baseRole) where.baseRole = filter.baseRole;
    if (filter.isPastor !== undefined) where.isPastor = filter.isPastor;
    if (filter.ministryId) {
      where.ministryMemberships = {
        some: { ministryId: filter.ministryId, leftAt: null },
      };
    }
    if (filter.search) {
      const q = filter.search.trim();
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(page.after ? { cursor: { id: decodeCursor(page.after) }, skip: 1 } : {}),
    });

    const hasNextPage = rows.length > page.first;
    const slice = rows.slice(0, page.first);

    return {
      edges: slice.map((node) => ({ node: toModel(node), cursor: encodeCursor(node.id) })),
      pageInfo: {
        hasNextPage,
        endCursor: slice.length ? encodeCursor(slice[slice.length - 1].id) : null,
      },
    };
  }
}

function toModel(u: UserRow) {
  return {
    ...u,
    fullName: `${u.firstName} ${u.lastName}`,
  };
}
