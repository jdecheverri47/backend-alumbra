import { Test } from '@nestjs/testing';
import { PrismaClient, User } from '@prisma/client';
import { wipeDb } from '../../test/setup/wipe-db';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { FeedService } from './feed.service';

const asAuth = (u: User): AuthenticatedUser => ({
  sub: u.id,
  email: u.email,
  isPastor: u.isPastor,
  baseRole: u.baseRole,
  user: u,
});

describe('FeedService', () => {
  let service: FeedService;
  let prisma: PrismaService;
  let pastor: User;
  let liderGrupo: User;
  let miembro: User;

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
    liderGrupo = await prisma.user.create({
      data: { email: 'lider@x.com', firstName: 'L', lastName: 'Dos', baseRole: 'MIEMBRO' },
    });
    miembro = await prisma.user.create({
      data: { email: 'miembro@x.com', firstName: 'M', lastName: 'Tres', baseRole: 'MIEMBRO' },
    });
    await prisma.group.create({
      data: { type: 'CONEXION', name: 'Conexión 1', leaderId: liderGrupo.id },
    });
  };

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [FeedService, PrismaService],
    }).compile();
    service = moduleRef.get(FeedService);
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

  describe('permissions', () => {
    it('canPost: pastores y líderes sí; miembros de a pie no', async () => {
      expect(await service.canPost(asAuth(pastor))).toBe(true);
      expect(await service.canPost(asAuth(liderGrupo))).toBe(true);
      expect(await service.canPost(asAuth(miembro))).toBe(false);
    });

    it('rejects POST from a plain member and ANUNCIO from a non-pastor leader', async () => {
      await expect(
        service.createPost(asAuth(miembro), { type: 'POST', body: 'hola', imageUrls: [] }),
      ).rejects.toThrow(/líderes/i);
      await expect(
        service.createPost(asAuth(liderGrupo), { type: 'ANUNCIO', body: 'aviso', imageUrls: [] }),
      ).rejects.toThrow(/pastores/i);
    });
  });

  describe('posts', () => {
    it('creates a post with images and lists it in the feed', async () => {
      await service.createPost(asAuth(liderGrupo), {
        type: 'POST',
        body: 'Bienvenidos al grupo',
        imageUrls: ['/uploads/a.jpg', '/uploads/b.jpg'],
      });

      const page = await service.feed(asAuth(miembro), { first: 10 });
      expect(page.edges).toHaveLength(1);
      expect(page.edges[0].node.images.map((i) => i.url)).toEqual([
        '/uploads/a.jpg',
        '/uploads/b.jpg',
      ]);
    });

    it('only ANUNCIO posts can be pinned; deleted posts leave the feed and lose the pin', async () => {
      const post = await service.createPost(asAuth(pastor), {
        type: 'POST',
        body: 'normal',
        imageUrls: [],
      });
      await expect(service.setPinned(post.id, true)).rejects.toThrow(/anuncios/i);

      const anuncio = await service.createPost(asAuth(pastor), {
        type: 'ANUNCIO',
        body: 'importante',
        imageUrls: [],
      });
      await service.setPinned(anuncio.id, true);
      expect((await service.pinnedAnnouncements()).map((p) => p.id)).toEqual([anuncio.id]);

      await service.deletePost(asAuth(pastor), anuncio.id);
      expect(await service.pinnedAnnouncements()).toHaveLength(0);
      const page = await service.feed(asAuth(miembro), { first: 10 });
      expect(page.edges.map((e) => e.node.id)).toEqual([post.id]);
    });

    it('only the author or a pastor deletes a post', async () => {
      const post = await service.createPost(asAuth(liderGrupo), {
        type: 'POST',
        body: 'x',
        imageUrls: [],
      });
      await expect(service.deletePost(asAuth(miembro), post.id)).rejects.toThrow(/autor|pastor/i);
      await expect(service.deletePost(asAuth(pastor), post.id)).resolves.toBeTruthy();
    });
  });

  describe('reactions & comments', () => {
    it('one reaction per user, replaceable and removable', async () => {
      const post = await service.createPost(asAuth(pastor), {
        type: 'POST',
        body: 'x',
        imageUrls: [],
      });

      await service.react(asAuth(miembro), post.id, 'LIKE');
      await service.react(asAuth(miembro), post.id, 'AMEN'); // replaces
      await service.react(asAuth(liderGrupo), post.id, 'AMEN');

      const counts = await service.reactionCounts(post.id);
      expect(counts).toEqual([{ type: 'AMEN', count: 2 }]);
      expect(await service.myReaction(miembro.id, post.id)).toBe('AMEN');

      await service.removeReaction(asAuth(miembro), post.id);
      expect(await service.myReaction(miembro.id, post.id)).toBeNull();
    });

    it('anyone authenticated comments; deletion is author/post-author/pastor only', async () => {
      const post = await service.createPost(asAuth(liderGrupo), {
        type: 'POST',
        body: 'x',
        imageUrls: [],
      });
      const comment = await service.addComment(asAuth(miembro), {
        postId: post.id,
        body: '¡Amén!',
      });
      expect(await service.commentCount(post.id)).toBe(1);

      // Another plain user cannot delete it.
      const otro = await prisma.user.create({
        data: { email: 'otro@x.com', firstName: 'O', lastName: 'C', baseRole: 'MIEMBRO' },
      });
      await expect(service.deleteComment(asAuth(otro), comment.id)).rejects.toThrow(/autor/i);

      // The post author can.
      await service.deleteComment(asAuth(liderGrupo), comment.id);
      expect(await service.commentCount(post.id)).toBe(0);
    });
  });
});
