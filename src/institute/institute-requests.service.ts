import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InstituteRequestStatus, Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { toUserModel } from '../users/dto/to-user-model';
import { InstituteRequestModel, MyInstituteRequestModel } from './dto/institute-request.models';

export const REVIEW_PERMISSION = 'instituto.inscripciones';
/** Tras un rechazo, cuánto hay que esperar para volver a pedir entrar. */
export const RETRY_DAYS = 30;
const NOTE_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const REQUEST_INCLUDE = {
  reviewedBy: true,
  user: {
    include: {
      ministryMemberships: { where: { leftAt: null }, include: { ministry: true } },
      groupMemberships: {
        where: { leftAt: null, group: { archivedAt: null } },
        include: { group: true },
      },
    },
  },
} satisfies Prisma.InstituteEnrollmentRequestInclude;

type RequestRow = Prisma.InstituteEnrollmentRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

function toModel(r: RequestRow): InstituteRequestModel {
  return {
    id: r.id,
    user: toUserModel(r.user),
    note: r.note,
    status: r.status,
    reviewNote: r.reviewNote,
    reviewedByName: r.reviewedBy ? `${r.reviewedBy.firstName} ${r.reviewedBy.lastName}` : null,
    reviewedAt: r.reviewedAt,
    ministries: r.user.ministryMemberships.map((m) => m.ministry.name),
    groups: r.user.groupMemberships.map((g) => g.group.name),
    createdAt: r.createdAt,
  };
}

/**
 * Inscripción al Instituto por solicitud. Cualquiera con cuenta que no esté
 * inscrito puede pedir entrar; lo deciden quienes tienen "Aprobar
 * inscripciones" (y los pastores). Cada paso avisa por la campana.
 */
@Injectable()
export class InstituteRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  async mine(me: AuthenticatedUser): Promise<MyInstituteRequestModel> {
    const [enrolled, last] = await Promise.all([
      this.prisma.instituteEnrollment.findFirst({ where: { userId: me.sub, leftAt: null } }),
      this.prisma.instituteEnrollmentRequest.findFirst({
        where: { userId: me.sub },
        include: REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const againAt = this.retryDate(last);
    return {
      request: last ? toModel(last) : null,
      canRequest: !enrolled && last?.status !== 'PENDING' && !againAt,
      canRequestAgainAt: againAt,
    };
  }

  async request(me: AuthenticatedUser, rawNote?: string | null): Promise<InstituteRequestModel> {
    const note = rawNote?.trim() || null;
    if (note && note.length > NOTE_MAX) {
      throw new BadRequestException(`La nota no puede pasar de ${NOTE_MAX} caracteres.`);
    }
    const state = await this.mine(me);
    if (!state.canRequest) {
      throw new ConflictException({
        error: 'INSTITUTE_REQUEST_NOT_ALLOWED',
        message:
          state.request?.status === 'PENDING'
            ? 'Ya tienes una solicitud en revisión.'
            : state.canRequestAgainAt
              ? 'Podrás volver a pedirla más adelante.'
              : 'Ya estás inscrito en el Instituto.',
      });
    }

    let created: RequestRow;
    try {
      created = await this.prisma.instituteEnrollmentRequest.create({
        data: { userId: me.sub, note },
        include: REQUEST_INCLUDE,
      });
    } catch (e) {
      // Dos clics a la vez: el índice parcial deja pasar solo una pendiente.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          error: 'INSTITUTE_REQUEST_NOT_ALLOWED',
          message: 'Ya tienes una solicitud en revisión.',
        });
      }
      throw e;
    }

    await this.notifications.notify({
      type: 'instituto.solicitud.nueva',
      to: await this.permissions.usersWith(REVIEW_PERMISSION),
      title: `${created.user.firstName} ${created.user.lastName} quiere entrar al Instituto`,
      body: note,
      href: '/instituto/solicitudes',
      actorId: me.sub,
      data: { refId: created.id },
    });
    return toModel(created);
  }

  async cancel(me: AuthenticatedUser): Promise<boolean> {
    const pending = await this.prisma.instituteEnrollmentRequest.findFirst({
      where: { userId: me.sub, status: 'PENDING' },
    });
    if (!pending) return false;
    await this.prisma.instituteEnrollmentRequest.update({
      where: { id: pending.id },
      data: { status: 'CANCELLED' },
    });
    await this.notifications.resolve('instituto.solicitud.nueva', pending.id, 'CANCELLED', me.sub);
    return true;
  }

  async list(
    me: AuthenticatedUser,
    status: InstituteRequestStatus,
  ): Promise<InstituteRequestModel[]> {
    await this.permissions.assert(me, REVIEW_PERMISSION);
    const rows = await this.prisma.instituteEnrollmentRequest.findMany({
      where: { status, user: { deletedAt: null } },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
      take: status === 'PENDING' ? undefined : 100,
    });
    return rows.map(toModel);
  }

  pendingCount(): Promise<number> {
    return this.prisma.instituteEnrollmentRequest.count({
      where: { status: 'PENDING', user: { deletedAt: null } },
    });
  }

  /** Aprueba: lo inscribe como alumno (o lo reactiva si había salido). */
  async approve(me: AuthenticatedUser, id: string): Promise<InstituteRequestModel> {
    await this.permissions.assert(me, REVIEW_PERMISSION);
    const approved = await this.prisma.$transaction(async (tx) => {
      const request = await this.findPendingOrThrow(tx, id);
      await tx.instituteEnrollment.upsert({
        where: { userId: request.userId },
        create: { userId: request.userId, role: 'STUDENT' },
        // Un profesor no pide entrar; si saliera, vuelve con el rol que tenía.
        update: { leftAt: null },
      });
      return tx.instituteEnrollmentRequest.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: me.sub, reviewedAt: new Date() },
        include: REQUEST_INCLUDE,
      });
    });
    this.permissions.invalidate(approved.userId);
    await this.notifications.resolve('instituto.solicitud.nueva', id, 'APPROVED', me.sub);
    await this.notifications.notify({
      type: 'instituto.solicitud.respondida',
      to: [approved.userId],
      title: '¡Ya estás en el Instituto Bíblico!',
      body: 'Aprobaron tu inscripción. Entra para ver las clases y materiales.',
      href: '/instituto',
      actorId: me.sub,
      data: { refId: id },
    });
    return toModel(approved);
  }

  async reject(
    me: AuthenticatedUser,
    id: string,
    rawReviewNote?: string | null,
  ): Promise<InstituteRequestModel> {
    await this.permissions.assert(me, REVIEW_PERMISSION);
    const reviewNote = rawReviewNote?.trim() || null;
    if (reviewNote && reviewNote.length > NOTE_MAX) {
      throw new BadRequestException(`El motivo no puede pasar de ${NOTE_MAX} caracteres.`);
    }
    const rejected = await this.prisma.$transaction(async (tx) => {
      await this.findPendingOrThrow(tx, id);
      return tx.instituteEnrollmentRequest.update({
        where: { id },
        data: { status: 'REJECTED', reviewNote, reviewedById: me.sub, reviewedAt: new Date() },
        include: REQUEST_INCLUDE,
      });
    });
    await this.notifications.resolve('instituto.solicitud.nueva', id, 'REJECTED', me.sub);
    await this.notifications.notify({
      type: 'instituto.solicitud.respondida',
      to: [rejected.userId],
      title: 'Tu solicitud al Instituto no fue aprobada',
      body: reviewNote ?? `Podrás volver a pedirla en ${RETRY_DAYS} días.`,
      href: '/instituto',
      actorId: me.sub,
      data: { refId: id },
    });
    return toModel(rejected);
  }

  /**
   * Si un coordinador inscribe a mano a alguien que tenía la solicitud
   * pendiente, la solicitud queda aprobada y su aviso cerrado.
   */
  async closeOnManualEnroll(userIds: string[], reviewerId: string): Promise<void> {
    const pending = await this.prisma.instituteEnrollmentRequest.findMany({
      where: { userId: { in: userIds }, status: 'PENDING' },
    });
    if (pending.length === 0) return;
    await this.prisma.instituteEnrollmentRequest.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date() },
    });
    for (const p of pending) {
      await this.notifications.resolve('instituto.solicitud.nueva', p.id, 'APPROVED', reviewerId);
    }
  }

  private retryDate(
    last: { status: InstituteRequestStatus; reviewedAt: Date | null } | null,
  ): Date | null {
    if (last?.status !== 'REJECTED' || !last.reviewedAt) return null;
    const at = new Date(last.reviewedAt.getTime() + RETRY_DAYS * DAY_MS);
    return at > new Date() ? at : null;
  }

  private async findPendingOrThrow(tx: Prisma.TransactionClient, id: string) {
    const request = await tx.instituteEnrollmentRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException(`Solicitud ${id} no encontrada.`);
    if (request.status !== 'PENDING') {
      throw new ConflictException({
        error: 'INSTITUTE_REQUEST_ALREADY_REVIEWED',
        message:
          request.status === 'CANCELLED'
            ? 'La persona canceló esta solicitud.'
            : 'Esta solicitud ya fue revisada.',
      });
    }
    return request;
  }
}
