import { Test } from '@nestjs/testing';
import { PrismaClient, User } from '@prisma/client';
import { wipeDb } from '../../test/setup/wipe-db';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';

const asAuth = (u: User): AuthenticatedUser => ({
  sub: u.id,
  email: u.email,
  isPastor: u.isPastor,
  baseRole: u.baseRole,
  user: u,
});

const FROM = new Date('2026-08-01T00:00:00Z');
const TO = new Date('2026-09-30T23:59:59Z');

describe('EventsService', () => {
  let service: EventsService;
  let prisma: PrismaService;
  let pastor: User;
  let miembro: User;
  let asistente: User;

  const seedUsers = async () => {
    pastor = await prisma.user.create({
      data: {
        email: 'pastor@x.com',
        firstName: 'P',
        lastName: 'Uno',
        isPastor: true,
        baseRole: 'MIEMBRO',
      },
    });
    miembro = await prisma.user.create({
      data: { email: 'miembro@x.com', firstName: 'M', lastName: 'Dos', baseRole: 'MIEMBRO' },
    });
    asistente = await prisma.user.create({
      data: { email: 'asistente@x.com', firstName: 'A', lastName: 'Tres', baseRole: 'ASISTENTE' },
    });
  };

  const createEvent = (title: string, membersOnly: boolean) =>
    prisma.event.create({
      data: {
        title,
        startsAt: new Date('2026-08-30T15:00:00Z'),
        membersOnly,
        createdById: pastor.id,
      },
    });

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [EventsService, PrismaService],
    }).compile();
    service = moduleRef.get(EventsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await wipeDb(prisma as unknown as PrismaClient);
    await seedUsers();
  });

  afterAll(async () => {
    await wipeDb(prisma as unknown as PrismaClient);
    await prisma.$disconnect();
  });

  describe('listVisible con membersOnly', () => {
    it('oculta los eventos de miembros a un asistente', async () => {
      await createEvent('Culto general', false);
      await createEvent('Reunión de miembros', true);

      const visibles = await service.listVisible(asAuth(asistente), FROM, TO);

      expect(visibles.map((e) => e.title)).toEqual(['Culto general']);
    });

    it('se los muestra a un miembro', async () => {
      await createEvent('Culto general', false);
      await createEvent('Reunión de miembros', true);

      const visibles = await service.listVisible(asAuth(miembro), FROM, TO);

      expect(visibles.map((e) => e.title).sort()).toEqual(['Culto general', 'Reunión de miembros']);
    });

    it('se los muestra a un pastor', async () => {
      await createEvent('Reunión de miembros', true);

      const visibles = await service.listVisible(asAuth(pastor), FROM, TO);

      expect(visibles.map((e) => e.title)).toEqual(['Reunión de miembros']);
    });

    it('un pastor que aún no es miembro igual los ve', async () => {
      const pastorAsistente = await prisma.user.create({
        data: {
          email: 'pastor2@x.com',
          firstName: 'P',
          lastName: 'Dos',
          isPastor: true,
          baseRole: 'ASISTENTE',
        },
      });
      await createEvent('Reunión de miembros', true);

      const visibles = await service.listVisible(asAuth(pastorAsistente), FROM, TO);

      expect(visibles).toHaveLength(1);
    });
  });

  describe('eventos sin fecha', () => {
    const createUndated = (title: string, membersOnly = false) =>
      prisma.event.create({
        data: { title, startsAt: null, membersOnly, createdById: pastor.id },
      });

    it('no aparecen en el calendario', async () => {
      await createUndated('Bautizos');
      await createEvent('Culto general', false);

      const visibles = await service.listVisible(asAuth(miembro), FROM, TO);

      expect(visibles.map((e) => e.title)).toEqual(['Culto general']);
    });

    it('salen en la lista aparte', async () => {
      await createUndated('Bautizos');
      await createEvent('Culto general', false);

      const sinFecha = await service.listUndated(asAuth(miembro));

      expect(sinFecha.map((e) => e.title)).toEqual(['Bautizos']);
    });

    it('respetan membersOnly igual que el calendario', async () => {
      await createUndated('Retiro de miembros', true);

      expect(await service.listUndated(asAuth(asistente))).toHaveLength(0);
      expect(await service.listUndated(asAuth(miembro))).toHaveLength(1);
    });

    it('se les puede poner fecha después', async () => {
      const evento = await createUndated('Bautizos');

      const actualizado = await service.updateById(asAuth(pastor), evento.id, {
        startsAt: '2026-09-13T15:00:00Z',
      });

      expect(actualizado.startsAt).toEqual(new Date('2026-09-13T15:00:00Z'));
      expect(await service.listUndated(asAuth(miembro))).toHaveLength(0);
    });
  });

  describe('create', () => {
    it('guarda el flag membersOnly', async () => {
      const event = await service.create(asAuth(pastor), {
        title: 'Reunión de miembros',
        startsAt: '2026-08-30T15:00:00Z',
        membersOnly: true,
      });

      expect(event.membersOnly).toBe(true);
    });

    it('por defecto el evento es público', async () => {
      const event = await service.create(asAuth(pastor), {
        title: 'Culto general',
        startsAt: '2026-08-30T15:00:00Z',
      });

      expect(event.membersOnly).toBe(false);
    });

    it('acepta un evento sin fecha', async () => {
      const event = await service.create(asAuth(pastor), { title: 'Bautizos' });

      expect(event.startsAt).toBeNull();
    });

    it('rechaza endsAt sin startsAt', async () => {
      await expect(
        service.create(asAuth(pastor), {
          title: 'Bautizos',
          endsAt: '2026-09-13T17:00:00Z',
        }),
      ).rejects.toThrow(/endsAt requires startsAt/i);
    });
  });
});
