import { Test } from '@nestjs/testing';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { wipeDb } from '../../test/setup/wipe-db';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { RemindersService } from './reminders.service';

const NOW = new Date('2026-11-02T15:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe('RemindersService', () => {
  let service: RemindersService;
  let prisma: PrismaService;
  const ids: Record<string, string> = {};
  let moduleId: string;

  const user = async (key: string, data: Record<string, unknown> = {}) =>
    (ids[key] = (
      await prisma.user.create({
        data: {
          email: `${key}@alumbra.test`,
          firstName: key,
          lastName: 'P',
          canSignIn: true,
          ...data,
        },
      })
    ).id);

  const titlesOf = async (key: string) =>
    (
      await prisma.notification.findMany({
        where: { userId: ids[key] },
        orderBy: { title: 'asc' },
      })
    ).map((n) => `${n.type}: ${n.title}`);

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [RemindersService, NotificationsService, PrismaService],
    }).compile();
    service = moduleRef.get(RemindersService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await wipeDb(prisma);
    await user('profe');
    await user('alumna');
    await user('alumno');
    await user('miembro', { baseRole: 'MIEMBRO' });
    await user('asistente');
    await prisma.instituteEnrollment.createMany({
      data: [
        { userId: ids.profe, role: 'TEACHER' },
        { userId: ids.alumna, role: 'STUDENT' },
        { userId: ids.alumno, role: 'STUDENT' },
      ],
    });
    moduleId = (await prisma.instituteModule.create({ data: { title: 'Hermenéutica', order: 1 } }))
      .id;
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
  });

  const item = (title: string, data: Record<string, unknown>) =>
    prisma.instituteItem.create({
      data: { moduleId, authorId: ids.profe, kind: 'ASSIGNMENT', title, ...data },
    });

  it('avisa lo programado que ya se publicó, una sola vez', async () => {
    await item('Ya salió', { kind: 'MATERIAL', publishAt: hours(-1) });
    await item('Todavía no', { kind: 'MATERIAL', publishAt: hours(2) });
    await item('Muy viejo', { kind: 'MATERIAL', publishAt: hours(-24 * 5) });

    await service.tick(NOW);
    await service.tick(NOW);

    expect(await titlesOf('alumna')).toEqual([
      'instituto.contenido.nuevo: Material nuevo: Ya salió',
    ]);
    expect(await titlesOf('miembro')).toEqual([]);
  });

  it('recuerda la fecha límite solo a quien no ha entregado', async () => {
    const tarea = await item('Ensayo', { publishAt: hours(-48), dueAt: hours(20) });
    await item('Lejana', { publishAt: hours(-48), dueAt: hours(30) });
    await item('Vencida', { publishAt: hours(-48), dueAt: hours(-1) });
    await prisma.instituteSubmission.create({
      data: { itemId: tarea.id, studentId: ids.alumno, state: 'TURNED_IN', turnedInAt: NOW },
    });

    const result = await service.tick(NOW);

    expect(result.dueSoon).toBe(1);
    expect(await titlesOf('alumna')).toEqual(['instituto.fecha.proxima: Vence pronto: Ensayo']);
    expect(await titlesOf('alumno')).toEqual([]);
  });

  it('recuerda las clases a alumnos y profesores', async () => {
    await prisma.instituteClass.create({
      data: {
        moduleId,
        title: 'Clase 4',
        startsAt: hours(3),
        location: 'Salón 2',
        createdById: ids.profe,
      },
    });
    await prisma.instituteClass.create({
      data: { moduleId, title: 'Clase 5', startsAt: hours(26), createdById: ids.profe },
    });

    await service.tick(NOW);

    for (const who of ['profe', 'alumna', 'alumno']) {
      expect(await titlesOf(who)).toEqual(['instituto.clase.proxima: Clase: Clase 4']);
    }
    const [n] = await prisma.notification.findMany({ where: { userId: ids.alumna } });
    expect(n.body).toContain('Salón 2');
    expect(await titlesOf('miembro')).toEqual([]);
  });

  it('recuerda eventos a quien los ve: grupo, toda la iglesia o solo miembros', async () => {
    const group = await prisma.group.create({
      data: { type: 'CONEXION', name: 'Conexión Norte', leaderId: ids.profe },
    });
    await prisma.groupMembership.create({ data: { groupId: group.id, userId: ids.asistente } });
    const event = (title: string, data: Record<string, unknown>) =>
      prisma.event.create({ data: { title, createdById: ids.profe, startsAt: hours(5), ...data } });
    await event('Culto', {});
    await event('Asamblea', { membersOnly: true });
    await event('Reunión', { groupId: group.id });

    await service.tick(NOW);

    expect(await titlesOf('asistente')).toEqual([
      'calendario.evento.proximo: Culto',
      'calendario.evento.proximo: Reunión · Conexión Norte',
    ]);
    expect(await titlesOf('miembro')).toEqual([
      'calendario.evento.proximo: Asamblea',
      'calendario.evento.proximo: Culto',
    ]);
  });
});
