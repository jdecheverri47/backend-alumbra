import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MinistryRole,
  Newcomer,
  NewcomerFollowUp,
  NewcomerStatus,
  Prisma,
  User,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { toUserModel } from '../users/dto/to-user-model';
import {
  addFollowUpSchema,
  registerNewcomerSchema,
  updateNewcomerSchema,
} from './dto/inputs.schema';
import { NewcomerFollowUpModel, NewcomerModel } from './dto/newcomer.model';

export const ACOGIDA_SLUG = 'acogida';

/** Quién actúa en Acogida: pastor, coordinador o ministro. */
type AcogidaRole = 'PASTOR' | MinistryRole;

type NewcomerRow = Newcomer & {
  registeredBy: User;
  assignedTo: User | null;
  followUps: Array<Pick<NewcomerFollowUp, 'createdAt'>>;
  _count: { followUps: number };
};

const NEWCOMER_INCLUDE = {
  registeredBy: true,
  assignedTo: true,
  // Solo el último, para "último contacto".
  followUps: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { createdAt: true } },
  _count: { select: { followUps: true } },
};

function toNewcomerModel(n: NewcomerRow): NewcomerModel {
  return {
    id: n.id,
    firstName: n.firstName,
    lastName: n.lastName,
    fullName: `${n.firstName} ${n.lastName}`,
    phone: n.phone,
    email: n.email,
    birthDate: n.birthDate,
    neighborhood: n.neighborhood,
    firstVisitAt: n.firstVisitAt,
    howHeard: n.howHeard,
    invitedBy: n.invitedBy,
    interests: n.interests,
    prayerRequest: n.prayerRequest,
    notes: n.notes,
    consent: n.consent,
    status: n.status,
    registeredBy: toUserModel(n.registeredBy),
    assignedTo: n.assignedTo ? toUserModel(n.assignedTo) : null,
    followUpCount: n._count.followUps,
    lastFollowUpAt: n.followUps[0]?.createdAt ?? null,
    createdAt: n.createdAt,
  };
}

/**
 * Registro y seguimiento de las personas nuevas. Los datos son personales: solo
 * los ven pastores y quienes sirven en Acogida. Cualquiera del equipo registra,
 * edita y anota contactos; asignar responsables y borrar es de coordinadores y
 * pastores.
 */
@Injectable()
export class NewcomersService {
  constructor(private readonly prisma: PrismaService) {}

  /** El rol de `me` en Acogida; lanza si no tiene acceso. */
  async access(me: AuthenticatedUser): Promise<AcogidaRole> {
    if (me.isPastor) return 'PASTOR';
    const membership = await this.prisma.ministryMembership.findFirst({
      where: { userId: me.sub, leftAt: null, ministry: { slug: ACOGIDA_SLUG } },
      select: { role: true },
    });
    if (!membership) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo los pastores y el equipo de Acogida ven a las personas nuevas.',
      });
    }
    return membership.role;
  }

  private async assertCoordinator(me: AuthenticatedUser): Promise<void> {
    const role = await this.access(me);
    if (role === 'MEMBER') {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo los coordinadores de Acogida y los pastores pueden hacer esto.',
      });
    }
  }

  private async findRow(id: string): Promise<NewcomerRow> {
    const row = await this.prisma.newcomer.findFirst({
      where: { id, deletedAt: null },
      include: NEWCOMER_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Newcomer ${id} not found.`);
    return row;
  }

  async list(
    me: AuthenticatedUser,
    filter: { status?: NewcomerStatus; search?: string; assignedToMe?: boolean },
  ): Promise<NewcomerModel[]> {
    await this.access(me);
    const where: Prisma.NewcomerWhereInput = { deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.assignedToMe) where.assignedToId = me.sub;
    const q = filter.search?.trim();
    if (q) {
      where.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.newcomer.findMany({
      where,
      include: NEWCOMER_INCLUDE,
      orderBy: [{ firstVisitAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map(toNewcomerModel);
  }

  async get(me: AuthenticatedUser, id: string): Promise<NewcomerModel> {
    await this.access(me);
    return toNewcomerModel(await this.findRow(id));
  }

  async followUps(me: AuthenticatedUser, newcomerId: string): Promise<NewcomerFollowUpModel[]> {
    await this.access(me);
    const rows = await this.prisma.newcomerFollowUp.findMany({
      where: { newcomerId },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((f) => ({
      id: f.id,
      kind: f.kind,
      note: f.note,
      author: toUserModel(f.author),
      createdAt: f.createdAt,
    }));
  }

  async register(me: AuthenticatedUser, raw: unknown): Promise<NewcomerModel> {
    await this.access(me);
    const data = registerNewcomerSchema.parse(raw);
    const row = await this.prisma.newcomer.create({
      data: { ...data, interests: data.interests ?? [], registeredById: me.sub },
      include: NEWCOMER_INCLUDE,
    });
    return toNewcomerModel(row);
  }

  async update(me: AuthenticatedUser, id: string, raw: unknown): Promise<NewcomerModel> {
    await this.access(me);
    const data = updateNewcomerSchema.parse(raw);
    await this.findRow(id);
    const row = await this.prisma.newcomer.update({
      where: { id },
      data,
      include: NEWCOMER_INCLUDE,
    });
    return toNewcomerModel(row);
  }

  async setStatus(
    me: AuthenticatedUser,
    id: string,
    status: NewcomerStatus,
  ): Promise<NewcomerModel> {
    await this.access(me);
    await this.findRow(id);
    const row = await this.prisma.newcomer.update({
      where: { id },
      data: { status },
      include: NEWCOMER_INCLUDE,
    });
    return toNewcomerModel(row);
  }

  /** Responsable del seguimiento: alguien del equipo de Acogida (o un pastor). */
  async assign(me: AuthenticatedUser, id: string, userId: string | null): Promise<NewcomerModel> {
    await this.assertCoordinator(me);
    await this.findRow(id);
    if (userId) {
      const user = await this.prisma.user.findFirst({
        where: {
          id: userId,
          deletedAt: null,
          OR: [
            { isPastor: true },
            {
              ministryMemberships: {
                some: { leftAt: null, ministry: { slug: ACOGIDA_SLUG } },
              },
            },
          ],
        },
      });
      if (!user) {
        throw new BadRequestException({
          error: 'NOT_IN_ACOGIDA',
          message: 'El responsable tiene que ser del equipo de Acogida.',
        });
      }
    }
    const row = await this.prisma.newcomer.update({
      where: { id },
      data: { assignedToId: userId },
      include: NEWCOMER_INCLUDE,
    });
    return toNewcomerModel(row);
  }

  /**
   * Anota un contacto. Si la persona seguía como NUEVO, pasa a CONTACTADO: ya
   * alguien habló con ella.
   */
  async addFollowUp(me: AuthenticatedUser, raw: unknown): Promise<NewcomerFollowUpModel> {
    await this.access(me);
    const data = addFollowUpSchema.parse(raw);
    const newcomer = await this.findRow(data.newcomerId);
    const [followUp] = await this.prisma.$transaction([
      this.prisma.newcomerFollowUp.create({
        data: { ...data, authorId: me.sub },
        include: { author: true },
      }),
      ...(newcomer.status === 'NUEVO'
        ? [
            this.prisma.newcomer.update({
              where: { id: newcomer.id },
              data: { status: 'CONTACTADO' },
            }),
          ]
        : []),
    ]);
    return {
      id: followUp.id,
      kind: followUp.kind,
      note: followUp.note,
      author: toUserModel(followUp.author),
      createdAt: followUp.createdAt,
    };
  }

  async remove(me: AuthenticatedUser, id: string): Promise<NewcomerModel> {
    await this.assertCoordinator(me);
    await this.findRow(id);
    const row = await this.prisma.newcomer.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: NEWCOMER_INCLUDE,
    });
    return toNewcomerModel(row);
  }
}
