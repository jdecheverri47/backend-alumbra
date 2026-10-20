import { Test } from '@nestjs/testing';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { wipeDb } from '../../test/setup/wipe-db';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessRequestsService } from './access-requests.service';

describe('AccessRequestsService', () => {
  let service: AccessRequestsService;
  let prisma: PrismaService;
  let reviewerId: string;

  const createRequest = (overrides: Record<string, unknown> = {}) =>
    prisma.accessRequest.create({
      data: {
        email: 'nuevo@alumbra.test',
        googleId: 'g-nuevo',
        firstName: 'Nuevo',
        lastName: 'Visitante',
        photoUrl: 'https://lh3.googleusercontent.com/nuevo',
        phone: '3001234567',
        ...overrides,
      },
    });

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [AccessRequestsService, PrismaService, PermissionsService, NotificationsService],
    }).compile();
    service = moduleRef.get(AccessRequestsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await wipeDb(prisma);
    const reviewer = await prisma.user.create({
      data: { email: 'pastor@alumbra.test', firstName: 'Pa', lastName: 'Stor', isPastor: true },
    });
    reviewerId = reviewer.id;
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
  });

  describe('approve', () => {
    it('creates an ASISTENTE with access, linked to the Google account', async () => {
      const request = await createRequest();

      const approved = await service.approve(request.id, reviewerId);

      expect(approved).toMatchObject({ status: 'APPROVED', reviewedById: reviewerId });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'nuevo@alumbra.test' } });
      expect(user).toMatchObject({
        baseRole: 'ASISTENTE',
        canSignIn: true,
        googleId: 'g-nuevo',
        phone: '3001234567',
        passwordHash: null,
      });
      expect(approved.userId).toBe(user.id);
    });

    it('enables the existing user instead of creating a duplicate', async () => {
      const existing = await prisma.user.create({
        data: {
          email: 'nuevo@alumbra.test',
          firstName: 'Nombre',
          lastName: 'Importado',
          baseRole: 'MIEMBRO',
          phone: '3109999999',
        },
      });
      const request = await createRequest({ userId: existing.id });

      await service.approve(request.id, reviewerId);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
      // Lo que la iglesia ya tenía registrado manda sobre lo que trae Google.
      expect(user).toMatchObject({
        canSignIn: true,
        googleId: 'g-nuevo',
        firstName: 'Nombre',
        baseRole: 'MIEMBRO',
        phone: '3109999999',
      });
      expect(await prisma.user.count()).toBe(2);
    });

    it('picks up a user registered by email while the request was waiting', async () => {
      const request = await createRequest();
      const registered = await prisma.user.create({
        data: { email: 'nuevo@alumbra.test', firstName: 'Nuevo', lastName: 'Visitante' },
      });

      const approved = await service.approve(request.id, reviewerId);

      expect(approved.userId).toBe(registered.id);
      expect(await prisma.user.count()).toBe(2);
    });

    it('refuses an email that belongs to a soft-deleted user', async () => {
      await prisma.user.create({
        data: {
          email: 'nuevo@alumbra.test',
          firstName: 'Borrado',
          lastName: 'X',
          deletedAt: new Date(),
        },
      });
      const request = await createRequest();

      await expect(service.approve(request.id, reviewerId)).rejects.toMatchObject({
        response: { error: 'EMAIL_BELONGS_TO_DELETED_USER' },
      });
      expect(
        (await prisma.accessRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
      ).toBe('PENDING');
    });

    it('refuses a request that was already reviewed', async () => {
      const request = await createRequest({ status: 'REJECTED' });

      await expect(service.approve(request.id, reviewerId)).rejects.toMatchObject({
        response: { error: 'ACCESS_REQUEST_ALREADY_REVIEWED' },
      });
    });
  });

  describe('reject', () => {
    it('marks the request rejected and creates no user', async () => {
      const request = await createRequest();

      const rejected = await service.reject(request.id, reviewerId);

      expect(rejected).toMatchObject({ status: 'REJECTED', reviewedById: reviewerId });
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe('notifications', () => {
    it('avisa a quien aprueba accesos cuando llega una solicitud nueva', async () => {
      await prisma.user.update({ where: { id: reviewerId }, data: { canSignIn: true } });

      await service.recordFromGoogle(
        {
          email: 'nuevo@alumbra.test',
          googleId: 'g-nuevo',
          firstName: 'Nuevo',
          lastName: 'Visitante',
          photoUrl: null,
        },
        null,
        { note: 'Vengo los domingos' },
      );

      const [n] = await prisma.notification.findMany({ where: { userId: reviewerId } });
      expect(n).toMatchObject({
        type: 'acceso.solicitud.nueva',
        title: 'Nuevo Visitante pidió acceso',
        body: 'Vengo los domingos',
        href: '/personas',
      });
    });

    it('al resolverla, el aviso de cada revisor dice quién y cómo', async () => {
      const otro = await prisma.user.create({
        data: {
          email: 'otro@alumbra.test',
          firstName: 'Otro',
          lastName: 'Pastor',
          isPastor: true,
          canSignIn: true,
        },
      });
      await prisma.user.update({ where: { id: reviewerId }, data: { canSignIn: true } });
      await service.recordFromGoogle(
        {
          email: 'nuevo@alumbra.test',
          googleId: 'g-nuevo',
          firstName: 'Nuevo',
          lastName: 'Visitante',
          photoUrl: null,
        },
        null,
        {},
      );
      const request = await prisma.accessRequest.findFirstOrThrow();

      await service.reject(request.id, reviewerId);

      const rows = await prisma.notification.findMany({
        where: { type: 'acceso.solicitud.nueva' },
      });
      expect(rows).toHaveLength(2);
      for (const n of rows) {
        expect(n.data).toMatchObject({
          refId: request.id,
          resolution: 'REJECTED',
          resolvedByName: 'Pa Stor',
        });
      }
      expect(rows.find((n) => n.userId === reviewerId)!.readAt).not.toBeNull();
      expect(rows.find((n) => n.userId === otro.id)!.readAt).toBeNull();
    });

    it('le da la bienvenida a quien aprueban', async () => {
      const request = await createRequest();

      const approved = await service.approve(request.id, reviewerId);

      const [n] = await prisma.notification.findMany({ where: { userId: approved.userId! } });
      expect(n).toMatchObject({ type: 'acceso.solicitud.aprobada', actorId: reviewerId });
    });
  });

  describe('list', () => {
    it('returns only the requested status, oldest pending first', async () => {
      const older = await createRequest({ createdAt: new Date('2026-01-01') });
      await createRequest({
        email: 'otro@alumbra.test',
        googleId: 'g-otro',
        createdAt: new Date('2026-02-01'),
      });
      await createRequest({ email: 'r@alumbra.test', googleId: 'g-r', status: 'REJECTED' });

      const pending = await service.list('PENDING');

      expect(pending).toHaveLength(2);
      expect(pending[0].id).toBe(older.id);
    });
  });
});
