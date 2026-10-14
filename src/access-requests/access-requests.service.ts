import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessRequest, AccessRequestStatus, Prisma } from '@prisma/client';
import { GoogleIdentity } from '../auth/google-token.verifier';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessRequestDetails {
  phone?: string;
  note?: string;
}

@Injectable()
export class AccessRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra (o refresca) la solicitud de alguien que entró con Google sin
   * tener acceso. Una persona = una solicitud: se identifica por su cuenta de
   * Google o por su correo.
   *
   * Una solicitud rechazada se queda rechazada: volver a intentar no la reabre.
   * Una aprobada vuelve a pendiente, porque si llegó aquí es que le quitaron el
   * acceso después y alguien tiene que decidir de nuevo.
   */
  async recordFromGoogle(
    identity: GoogleIdentity,
    existingUserId: string | null,
    details: AccessRequestDetails,
  ): Promise<AccessRequest> {
    const existing = await this.prisma.accessRequest.findFirst({
      where: { OR: [{ googleId: identity.googleId }, { email: identity.email }] },
    });

    const profile = {
      email: identity.email,
      googleId: identity.googleId,
      firstName: identity.firstName,
      lastName: identity.lastName,
      photoUrl: identity.photoUrl,
      ...(details.phone ? { phone: details.phone } : {}),
      ...(details.note ? { note: details.note } : {}),
    };

    if (!existing) {
      return this.prisma.accessRequest.create({
        data: { ...profile, userId: existingUserId },
      });
    }

    return this.prisma.accessRequest.update({
      where: { id: existing.id },
      data: {
        ...profile,
        userId: existing.userId ?? existingUserId,
        ...(existing.status === 'APPROVED'
          ? { status: 'PENDING', reviewedById: null, reviewedAt: null }
          : {}),
      },
    });
  }

  list(status: AccessRequestStatus): Promise<AccessRequest[]> {
    return this.prisma.accessRequest.findMany({
      where: { status },
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' },
    });
  }

  /**
   * Da acceso: habilita al User que ya existía con ese correo (p. ej. importado
   * sin acceso, o registrado por Acogida mientras la solicitud esperaba) o crea
   * uno nuevo como asistente.
   */
  async approve(id: string, reviewerId: string): Promise<AccessRequest> {
    return this.prisma.$transaction(async (tx) => {
      const request = await this.findPendingOrThrow(tx, id);

      const existingUser = request.userId
        ? await tx.user.findUnique({ where: { id: request.userId } })
        : await tx.user.findFirst({ where: { email: request.email } });

      let userId: string;
      if (existingUser && existingUser.deletedAt === null) {
        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            canSignIn: true,
            googleId: existingUser.googleId ?? request.googleId,
            photoUrl: existingUser.photoUrl ?? request.photoUrl,
            phone: existingUser.phone ?? request.phone,
          },
        });
        userId = existingUser.id;
      } else {
        try {
          const created = await tx.user.create({
            data: {
              email: request.email,
              googleId: request.googleId,
              firstName: request.firstName,
              lastName: request.lastName,
              photoUrl: request.photoUrl,
              phone: request.phone,
              canSignIn: true,
            },
          });
          userId = created.id;
        } catch (e) {
          // El correo pertenece a un User eliminado: el soft delete lo esconde
          // de las búsquedas pero sigue ocupando el índice único.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new ConflictException({
              error: 'EMAIL_BELONGS_TO_DELETED_USER',
              message: `El correo ${request.email} pertenece a un usuario eliminado.`,
            });
          }
          throw e;
        }
      }

      return tx.accessRequest.update({
        where: { id },
        data: { status: 'APPROVED', userId, reviewedById: reviewerId, reviewedAt: new Date() },
      });
    });
  }

  async reject(id: string, reviewerId: string): Promise<AccessRequest> {
    return this.prisma.$transaction(async (tx) => {
      await this.findPendingOrThrow(tx, id);
      return tx.accessRequest.update({
        where: { id },
        data: { status: 'REJECTED', reviewedById: reviewerId, reviewedAt: new Date() },
      });
    });
  }

  private async findPendingOrThrow(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<AccessRequest> {
    const request = await tx.accessRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Access request ${id} not found.`);
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException({
        error: 'ACCESS_REQUEST_ALREADY_REVIEWED',
        message: 'Esta solicitud ya fue revisada.',
      });
    }
    return request;
  }
}
