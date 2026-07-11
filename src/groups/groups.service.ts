import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Course, Group, GroupMembership, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { addUserToGroupSchema, createGroupSchema, updateGroupSchema } from './dto/inputs.schema';

const RUTA_SLUG = 'ruta-crecimiento';
const EVANGELIO_SLUG = 'evangelio';
const GROUP_INCLUDE = { leader: true, course: true };

type GroupWithLeader = Group & { leader: User; course: Course | null };

/** Etapas del proceso de membresía que habilitan entrar a una cohorte de la Ruta. */
const RUTA_ELIGIBLE_STAGES = [
  'VALIDADO',
  'EN_RUTA',
  'ENTREGA_FINAL',
  'FILTRO_IGLESIA',
  'ENTREVISTA_PASTORAL',
] as const;

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(me: AuthenticatedUser, raw: unknown): Promise<GroupWithLeader> {
    const data = createGroupSchema.parse(raw);
    const leaderId = data.leaderId ?? me.sub;

    const leader = await this.prisma.user.findFirst({ where: { id: leaderId } });
    if (!leader) throw new NotFoundException(`User ${leaderId} not found.`);
    if (data.type === 'MADUREZ' && !leader.isPastor && !leader.isLeader) {
      throw new BadRequestException(
        'Los grupos de madurez deben ser dirigidos por un pastor o un líder asignado.',
      );
    }

    if (data.courseId) {
      const course = await this.prisma.course.findUnique({ where: { id: data.courseId } });
      if (!course) throw new NotFoundException(`Course ${data.courseId} not found.`);
      // La Ruta la da un líder asignado (rol otorgado por los pastores) o un pastor.
      if (course.slug === RUTA_SLUG && !leader.isPastor && !leader.isLeader) {
        throw new BadRequestException(
          'Las cohortes de la Ruta deben ser dirigidas por un líder asignado o un pastor.',
        );
      }
    }

    return this.prisma.group.create({
      data: {
        type: data.type,
        name: data.name,
        description: data.description,
        leaderId,
        courseId: data.courseId,
        meetingDay: data.meetingDay,
        meetingTime: data.meetingTime,
        location: data.location,
      },
      include: GROUP_INCLUDE,
    });
  }

  async updateById(me: AuthenticatedUser, id: string, raw: unknown): Promise<GroupWithLeader> {
    const data = updateGroupSchema.parse(raw);
    const group = await this.findByIdOrThrow(id);
    this.assertLeaderOrPastor(me, group);
    return this.prisma.group.update({ where: { id }, data, include: GROUP_INCLUDE });
  }

  /** Cierra el grupo (completado). Lo puede hacer su líder o un pastor. */
  async archive(me: AuthenticatedUser, id: string): Promise<GroupWithLeader> {
    const group = await this.findByIdOrThrow(id);
    this.assertLeaderOrPastor(me, group);
    return this.prisma.group.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: GROUP_INCLUDE,
    });
  }

  /** Reabre un grupo cerrado (solo pastores, guard en el resolver). */
  async reopen(id: string): Promise<GroupWithLeader> {
    await this.findByIdOrThrow(id);
    return this.prisma.group.update({
      where: { id },
      data: { archivedAt: null },
      include: GROUP_INCLUDE,
    });
  }

  async findByIdOrThrow(id: string): Promise<GroupWithLeader> {
    const group = await this.prisma.group.findUnique({ where: { id }, include: GROUP_INCLUDE });
    if (!group) throw new NotFoundException(`Group ${id} not found.`);
    return group;
  }

  /** Group detail: visible to active members, the leader, and pastors. */
  async findForViewer(me: AuthenticatedUser, id: string): Promise<GroupWithLeader> {
    const group = await this.findByIdOrThrow(id);
    if (me.isPastor || group.leaderId === me.sub) return group;
    const membership = await this.prisma.groupMembership.findFirst({
      where: { groupId: id, userId: me.sub, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'No perteneces a este grupo.',
      });
    }
    return group;
  }

  /** Groups where the user is an active member or the leader. Excludes archived. */
  async myGroups(userId: string): Promise<GroupWithLeader[]> {
    return this.prisma.group.findMany({
      where: {
        archivedAt: null,
        OR: [{ leaderId: userId }, { memberships: { some: { userId, leftAt: null } } }],
      },
      include: GROUP_INCLUDE,
      orderBy: { name: 'asc' },
    });
  }

  async list(opts: { includeArchived?: boolean } = {}): Promise<GroupWithLeader[]> {
    return this.prisma.group.findMany({
      where: opts.includeArchived ? {} : { archivedAt: null },
      include: GROUP_INCLUDE,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Cohortes de la Ruta con su estado, para agrupar por líder en el tablero.
   * Pastores ven todas; un líder solo las suyas.
   */
  async rutaCohortOverviews(me: AuthenticatedUser) {
    const groups = await this.prisma.group.findMany({
      where: {
        archivedAt: null,
        course: { slug: RUTA_SLUG },
        ...(me.isPastor ? {} : { leaderId: me.sub }),
      },
      include: {
        ...GROUP_INCLUDE,
        memberships: { where: { leftAt: null }, select: { id: true } },
        sessions: {
          select: { lessonId: true, status: true, startsAt: true, title: true },
          orderBy: { startsAt: 'asc' },
        },
      },
      orderBy: [{ leaderId: 'asc' }, { name: 'asc' }],
    });

    const lessonsTotal = await this.prisma.courseLesson.count({
      where: { topic: { course: { slug: RUTA_SLUG } } },
    });

    const now = new Date();
    return groups.map((group) => {
      const completedLessons = new Set(
        group.sessions
          .filter((s) => s.lessonId && s.status === 'COMPLETADA')
          .map((s) => s.lessonId),
      );
      const next = group.sessions.find(
        (s) => s.startsAt >= now && s.status !== 'CANCELADA' && s.status !== 'COMPLETADA',
      );
      return {
        group,
        studentCount: group.memberships.length,
        lessonsTotal,
        lessonsCompleted: completedLessons.size,
        nextSessionAt: next?.startsAt ?? null,
        nextSessionTitle: next?.title ?? null,
      };
    });
  }

  async listMembers(groupId: string): Promise<Array<GroupMembership & { user: User }>> {
    return this.prisma.groupMembership.findMany({
      where: { groupId, leftAt: null, user: { deletedAt: null } },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async addMember(me: AuthenticatedUser, raw: unknown): Promise<GroupMembership & { user: User }> {
    const { userId, groupId } = addUserToGroupSchema.parse(raw);
    const group = await this.findByIdOrThrow(groupId);
    this.assertLeaderOrPastor(me, group);
    if (group.archivedAt) {
      throw new BadRequestException('No se pueden agregar personas a un grupo archivado.');
    }

    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User ${userId} not found.`);
    if (group.type === 'CONEXION' && user.baseRole !== 'ASISTENTE') {
      throw new BadRequestException(
        'Los grupos de conexión son para asistentes; los miembros pertenecen a grupos de madurez.',
      );
    }
    // Evangelio funciona como un grupo de conexión más: solo para no miembros.
    if (group.course?.slug === EVANGELIO_SLUG && user.baseRole === 'MIEMBRO') {
      throw new BadRequestException(
        'El curso de Evangelio es para no miembros; los miembros ya lo recorrieron.',
      );
    }
    // A la Ruta solo se entra validado por el entrevistador (vía assignJourneyToRuta o aquí).
    if (group.course?.slug === RUTA_SLUG) {
      const journey = await this.prisma.membershipJourney.findUnique({ where: { userId } });
      if (!journey || !RUTA_ELIGIBLE_STAGES.includes(journey.stage as never)) {
        throw new BadRequestException(
          'Para entrar a la Ruta la persona debe estar validada en su proceso de membresía.',
        );
      }
    }

    const existingActive = await this.prisma.groupMembership.findFirst({
      where: { userId, groupId, leftAt: null },
    });
    if (existingActive) {
      throw new ConflictException('La persona ya pertenece a este grupo.');
    }

    return this.prisma.groupMembership.create({
      data: { userId, groupId, addedById: me.sub },
      include: { user: true },
    });
  }

  async removeMember(
    me: AuthenticatedUser,
    membershipId: string,
  ): Promise<GroupMembership & { user: User }> {
    const membership = await this.prisma.groupMembership.findUnique({
      where: { id: membershipId },
      include: { user: true, group: { include: GROUP_INCLUDE } },
    });
    if (!membership) throw new NotFoundException(`Membership ${membershipId} not found.`);
    this.assertLeaderOrPastor(me, membership.group);
    if (membership.leftAt) return membership;
    return this.prisma.groupMembership.update({
      where: { id: membershipId },
      data: { leftAt: new Date() },
      include: { user: true },
    });
  }

  private assertLeaderOrPastor(me: AuthenticatedUser, group: Group): void {
    if (!me.isPastor && group.leaderId !== me.sub) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo el líder del grupo o un pastor puede hacer esto.',
      });
    }
  }
}
