import { Test } from '@nestjs/testing';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { wipeDb } from '../../test/setup/wipe-db';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: PrismaService;
  let ana: string;
  let beto: string;

  const user = (email: string, data: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: { email, firstName: email.split('@')[0], lastName: 'Prueba', canSignIn: true, ...data },
    });

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [NotificationsService, PrismaService],
    }).compile();
    service = moduleRef.get(NotificationsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await wipeDb(prisma);
    ana = (await user('ana@alumbra.test')).id;
    beto = (await user('beto@alumbra.test')).id;
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
  });

  describe('notify', () => {
    it('crea uno por destinatario, sin repetir ni avisarle al actor', async () => {
      await service.notify({
        type: 'muro.comentario',
        to: [ana, ana, beto],
        title: 'Comentaron tu publicación',
        actorId: beto,
      });

      const rows = await prisma.notification.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: ana, actorId: beto, readAt: null });
    });

    it('no le avisa a quien no puede entrar ni a los eliminados', async () => {
      const importado = (await user('imp@alumbra.test', { canSignIn: false })).id;
      const borrado = (await user('del@alumbra.test', { deletedAt: new Date() })).id;

      await service.notify({ type: 'muro.anuncio.nuevo', to: [importado, borrado], title: 'X' });

      expect(await prisma.notification.count()).toBe(0);
    });
  });

  describe('list y leídas', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await prisma.notification.create({
          data: {
            userId: ana,
            type: 'muro.anuncio.nuevo',
            title: `Aviso ${i}`,
            createdAt: new Date(2026, 0, i + 1),
          },
        });
      }
      await prisma.notification.create({
        data: { userId: beto, type: 'muro.anuncio.nuevo', title: 'De Beto' },
      });
    });

    it('pagina lo más reciente primero y solo lo propio', async () => {
      const first = await service.list(ana, { first: 2 });
      expect(first.edges.map((e) => e.node.title)).toEqual(['Aviso 2', 'Aviso 1']);
      expect(first.pageInfo.hasNextPage).toBe(true);

      const next = await service.list(ana, { first: 2, after: first.pageInfo.endCursor! });
      expect(next.edges.map((e) => e.node.title)).toEqual(['Aviso 0']);
      expect(next.pageInfo.hasNextPage).toBe(false);
    });

    it('cuenta, marca una y marca todas', async () => {
      expect(await service.unreadCount(ana)).toBe(3);

      const [one] = (await service.list(ana, { first: 1 })).edges;
      expect(await service.markRead(ana, one.node.id)).toBe(true);
      expect(await service.unreadCount(ana)).toBe(2);

      expect(await service.markAllRead(ana)).toBe(2);
      expect(await service.unreadCount(ana)).toBe(0);
      expect(await service.unreadCount(beto)).toBe(1);
    });

    it('no deja marcar la de otra persona', async () => {
      const ajena = await prisma.notification.findFirstOrThrow({ where: { userId: beto } });

      expect(await service.markRead(ana, ajena.id)).toBe(false);
      expect(await service.unreadCount(beto)).toBe(1);
    });
  });
});
