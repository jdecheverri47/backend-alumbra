import { Test } from '@nestjs/testing';
import { PrismaClient, User } from '@prisma/client';
import { wipeDb } from '../../test/setup/wipe-db';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { GroupSessionsService } from './group-sessions.service';

const asAuth = (u: User): AuthenticatedUser => ({
  sub: u.id,
  email: u.email,
  isPastor: u.isPastor,
  baseRole: u.baseRole,
  user: u,
});

describe('GroupSessionsService', () => {
  let service: GroupSessionsService;
  let prisma: PrismaService;
  let pastor: User;
  let lider: User;
  let miembro: User;
  let externo: User;
  let groupId: string;

  const nextThursday = new Date('2026-07-16T19:00:00-05:00');

  const seed = async () => {
    pastor = await prisma.user.create({
      data: {
        email: 'pastor@x.com',
        firstName: 'P',
        lastName: 'Uno',
        isPastor: true,
        baseRole: 'MIEMBRO',
      },
    });
    lider = await prisma.user.create({
      data: { email: 'lider@x.com', firstName: 'L', lastName: 'Dos', baseRole: 'MIEMBRO' },
    });
    miembro = await prisma.user.create({
      data: { email: 'miembro@x.com', firstName: 'M', lastName: 'Tres', baseRole: 'ASISTENTE' },
    });
    externo = await prisma.user.create({
      data: { email: 'externo@x.com', firstName: 'X', lastName: 'Cuatro', baseRole: 'MIEMBRO' },
    });
    const group = await prisma.group.create({
      data: {
        type: 'CONEXION',
        name: 'Conexión 1',
        leaderId: lider.id,
        meetingDay: 4,
        meetingTime: '19:00',
      },
    });
    groupId = group.id;
    await prisma.groupMembership.create({ data: { userId: miembro.id, groupId } });
  };

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [GroupSessionsService, PrismaService],
    }).compile();
    service = moduleRef.get(GroupSessionsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await wipeDb(prisma as unknown as PrismaClient);
    await seed();
  });

  afterAll(async () => {
    await wipeDb(prisma as unknown as PrismaClient);
    await prisma.$disconnect();
  });

  describe('clases', () => {
    it('el líder crea la clase; duplicada para la misma fecha se rechaza; miembro no puede', async () => {
      const session = await service.create(asAuth(lider), {
        groupId,
        scheduledFor: nextThursday,
        title: 'Clase 1',
      });
      expect(session.status).toBe('PROGRAMADA');
      expect(session.startsAt.getTime()).toBe(nextThursday.getTime());

      await expect(
        service.create(asAuth(lider), { groupId, scheduledFor: nextThursday }),
      ).rejects.toThrow(/ya existe/i);
      await expect(
        service.create(asAuth(miembro), { groupId, scheduledFor: new Date('2026-07-23') }),
      ).rejects.toThrow(/líder|pastor/i);
    });

    it('completar marca COMPLETADA (solo líder/pastor; nunca una cancelada)', async () => {
      const session = await service.create(asAuth(lider), {
        groupId,
        scheduledFor: nextThursday,
      });
      await expect(service.complete(asAuth(miembro), session.id)).rejects.toThrow(/líder|pastor/i);
      const done = await service.complete(asAuth(lider), session.id);
      expect(done.status).toBe('COMPLETADA');

      await service.cancel(asAuth(lider), session.id);
      await expect(service.complete(asAuth(lider), session.id)).rejects.toThrow(/cancelada/i);
    });

    it('reprogramar cambia startsAt y estado; cancelar marca CANCELADA; reprogramar reactiva', async () => {
      const session = await service.create(asAuth(lider), {
        groupId,
        scheduledFor: nextThursday,
      });

      const newDate = new Date('2026-07-18T10:00:00-05:00');
      const rescheduled = await service.reschedule(asAuth(lider), session.id, {
        startsAt: newDate,
        note: 'Feriado',
      });
      expect(rescheduled.status).toBe('REPROGRAMADA');
      expect(rescheduled.startsAt.getTime()).toBe(newDate.getTime());
      expect(rescheduled.scheduledFor.getTime()).toBe(nextThursday.getTime());

      const canceled = await service.cancel(asAuth(pastor), session.id, 'Sin quórum');
      expect(canceled.status).toBe('CANCELADA');

      const revived = await service.reschedule(asAuth(lider), session.id, { startsAt: newDate });
      expect(revived.status).toBe('REPROGRAMADA');
    });

    it('listInRange es agenda personal: solo clases de grupos que dicto o asisto (pastor incluido)', async () => {
      await service.create(asAuth(lider), { groupId, scheduledFor: nextThursday });
      const from = new Date('2026-07-01');
      const to = new Date('2026-07-31');

      expect(await service.listInRange(asAuth(miembro), from, to)).toHaveLength(1);
      expect(await service.listInRange(asAuth(lider), from, to)).toHaveLength(1);
      expect(await service.listInRange(asAuth(externo), from, to)).toHaveLength(0);
      // El pastor no dicta ni asiste a este grupo: su agenda no lo incluye.
      expect(await service.listInRange(asAuth(pastor), from, to)).toHaveLength(0);
    });
  });

  describe('asistencia', () => {
    it('el líder registra ingreso con hora; es idempotente y conserva la primera hora', async () => {
      const session = await service.create(asAuth(lider), {
        groupId,
        scheduledFor: nextThursday,
      });

      const first = await service.checkIn(asAuth(lider), session.id, miembro.id);
      expect(first.user.id).toBe(miembro.id);
      expect(first.checkedInAt).toBeInstanceOf(Date);

      const again = await service.checkIn(asAuth(lider), session.id, miembro.id);
      expect(again.checkedInAt.getTime()).toBe(first.checkedInAt.getTime());
    });

    it('rechaza check-in de no-miembros, por no-líderes y en clases canceladas', async () => {
      const session = await service.create(asAuth(lider), {
        groupId,
        scheduledFor: nextThursday,
      });

      await expect(service.checkIn(asAuth(lider), session.id, externo.id)).rejects.toThrow(
        /no pertenece/i,
      );
      await expect(service.checkIn(asAuth(miembro), session.id, miembro.id)).rejects.toThrow(
        /líder|pastor/i,
      );

      await service.cancel(asAuth(lider), session.id);
      await expect(service.checkIn(asAuth(lider), session.id, miembro.id)).rejects.toThrow(
        /cancelada/i,
      );
    });

    it('la asistencia completa solo la ve el líder/pastor; el miembro ve la suya', async () => {
      const session = await service.create(asAuth(lider), {
        groupId,
        scheduledFor: nextThursday,
      });
      const otro = await prisma.user.create({
        data: { email: 'otro@x.com', firstName: 'O', lastName: '5', baseRole: 'ASISTENTE' },
      });
      await prisma.groupMembership.create({ data: { userId: otro.id, groupId } });
      await service.checkIn(asAuth(lider), session.id, miembro.id);
      await service.checkIn(asAuth(lider), session.id, otro.id);

      const asLeader = await service.findForViewer(asAuth(lider), session.id);
      expect(asLeader.attendances).toHaveLength(2);

      const asMember = await service.findForViewer(asAuth(miembro), session.id);
      expect(asMember.attendances).toHaveLength(1);
      expect(asMember.attendances[0].user.id).toBe(miembro.id);
    });
  });

  describe('material y trabajos', () => {
    it('solo líder/pastor sube material; los miembros lo ven', async () => {
      const session = await service.create(asAuth(lider), {
        groupId,
        scheduledFor: nextThursday,
      });

      await expect(
        service.addMaterial(asAuth(miembro), {
          sessionId: session.id,
          title: 'Guía',
          url: '/uploads/guia.pdf',
        }),
      ).rejects.toThrow(/líder|pastor/i);

      await service.addMaterial(asAuth(lider), {
        sessionId: session.id,
        title: 'Guía',
        url: '/uploads/guia.pdf',
      });
      const asMember = await service.findForViewer(asAuth(miembro), session.id);
      expect(asMember.materials.map((m) => m.title)).toEqual(['Guía']);
    });

    it('flujo de trabajo: líder lo deja, miembro entrega (re-subir reemplaza), visibilidad por rol', async () => {
      const session = await service.create(asAuth(lider), {
        groupId,
        scheduledFor: nextThursday,
      });
      const assignment = await service.createAssignment(asAuth(lider), {
        sessionId: session.id,
        title: 'Leer capítulo 3',
      });

      await expect(
        service.submitAssignment(asAuth(externo), {
          assignmentId: assignment.id,
          url: '/uploads/tarea-externo.pdf',
        }),
      ).rejects.toThrow(/no pertenece/i);

      const first = await service.submitAssignment(asAuth(miembro), {
        assignmentId: assignment.id,
        url: '/uploads/tarea-v1.pdf',
      });
      const second = await service.submitAssignment(asAuth(miembro), {
        assignmentId: assignment.id,
        url: '/uploads/tarea-v2.pdf',
      });
      expect(second.id).toBe(first.id);
      expect(second.url).toBe('/uploads/tarea-v2.pdf');

      // Otro miembro entrega también.
      const otro = await prisma.user.create({
        data: { email: 'otro@x.com', firstName: 'O', lastName: '5', baseRole: 'ASISTENTE' },
      });
      await prisma.groupMembership.create({ data: { userId: otro.id, groupId } });
      await service.submitAssignment(asAuth(otro), {
        assignmentId: assignment.id,
        url: '/uploads/tarea-otro.pdf',
      });

      // El líder ve todas las entregas con quién y archivo.
      const asLeader = await service.findForViewer(asAuth(lider), session.id);
      expect(asLeader.assignments[0].submissions).toHaveLength(2);

      // El miembro solo ve la suya.
      const asMember = await service.findForViewer(asAuth(miembro), session.id);
      expect(asMember.assignments[0].submissions).toHaveLength(1);
      expect(asMember.assignments[0].mySubmission?.url).toBe('/uploads/tarea-v2.pdf');
    });
  });
});
