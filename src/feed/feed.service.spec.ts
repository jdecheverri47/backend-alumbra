import { Test } from '@nestjs/testing';
import { PrismaClient, User } from '@prisma/client';
import { wipeDb } from '../../test/setup/wipe-db';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { FeedAudience } from './dto/feed-audience.enum';
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
      expect((await service.pinnedAnnouncements(asAuth(miembro))).map((p) => p.id)).toEqual([
        anuncio.id,
      ]);

      await service.deletePost(asAuth(pastor), anuncio.id);
      expect(await service.pinnedAnnouncements(asAuth(miembro))).toHaveLength(0);
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

  describe('polls', () => {
    const createPoll = (options: string[], durationHours?: number) =>
      service.createPost(asAuth(pastor), {
        body: '¿Qué día prefieren para el retiro?',
        poll: { options, durationHours },
      });

    it('creates the poll with its options in order and no votes', async () => {
      const post = await createPoll(['Sábado', 'Domingo'], 24);

      const poll = await service.pollFor(post.id, miembro.id);
      expect(poll).toMatchObject({
        totalVotes: 0,
        myVoteOptionId: null,
        isClosed: false,
        options: [
          { text: 'Sábado', votes: 0 },
          { text: 'Domingo', votes: 0 },
        ],
      });
      expect(poll!.closesAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    });

    it('returns null for a post without poll', async () => {
      const post = await service.createPost(asAuth(pastor), { body: 'hola' });
      expect(await service.pollFor(post.id, miembro.id)).toBeNull();
    });

    it('rejects fewer than 2, more than 4, or repeated options', async () => {
      await expect(createPoll(['Solo una'])).rejects.toThrow();
      await expect(createPoll(['a', 'b', 'c', 'd', 'e'])).rejects.toThrow();
      await expect(createPoll(['Sí', 'sí'])).rejects.toThrow(/distinct/);
    });

    it('counts votes and remembers mine; any member can vote', async () => {
      const post = await createPoll(['Sábado', 'Domingo']);
      const [sabado, domingo] = (await service.pollFor(post.id, miembro.id))!.options;

      await service.votePoll(asAuth(liderGrupo), { optionId: domingo.id });
      const mine = await service.votePoll(asAuth(miembro), { optionId: sabado.id });

      expect(mine.totalVotes).toBe(2);
      expect(mine.myVoteOptionId).toBe(sabado.id);
      expect(mine.options.map((o) => o.votes)).toEqual([1, 1]);
    });

    it('allows only one vote per person', async () => {
      const post = await createPoll(['Sábado', 'Domingo']);
      const [sabado, domingo] = (await service.pollFor(post.id, miembro.id))!.options;

      await service.votePoll(asAuth(miembro), { optionId: sabado.id });
      await expect(
        service.votePoll(asAuth(miembro), { optionId: domingo.id }),
      ).rejects.toMatchObject({ response: { error: 'ALREADY_VOTED' } });
    });

    it('rejects votes once the poll closed', async () => {
      const post = await createPoll(['Sábado', 'Domingo'], 1);
      await prisma.postPoll.update({
        where: { postId: post.id },
        data: { closesAt: new Date(Date.now() - 1000) },
      });
      const poll = (await service.pollFor(post.id, miembro.id))!;

      expect(poll.isClosed).toBe(true);
      await expect(
        service.votePoll(asAuth(miembro), { optionId: poll.options[0].id }),
      ).rejects.toMatchObject({ response: { error: 'POLL_CLOSED' } });
    });
  });

  describe('visibility and who may post', () => {
    let asistente: User;

    beforeEach(async () => {
      asistente = await prisma.user.create({
        data: { email: 'asistente@x.com', firstName: 'A', lastName: 'Cuatro' },
      });
    });

    it('an asistente cannot post even when leading a group', async () => {
      await prisma.group.create({
        data: { type: 'CONEXION', name: 'Conexión A', leaderId: asistente.id },
      });

      expect(await service.canPost(asAuth(asistente))).toBe(false);
      await expect(service.createPost(asAuth(asistente), { body: 'hola' })).rejects.toThrow(
        /líderes/i,
      );
    });

    it('hides internal posts from asistentes everywhere, but not from members', async () => {
      const publico = await service.createPost(asAuth(pastor), { body: 'para todos' });
      const interno = await service.createPost(asAuth(pastor), {
        type: 'ANUNCIO',
        body: 'solo miembros',
        membersOnly: true,
      });
      await service.setPinned(interno.id, true);

      const forAsistente = await service.feed(asAuth(asistente), { first: 10 });
      expect(forAsistente.edges.map((e) => e.node.id)).toEqual([publico.id]);
      expect(await service.pinnedAnnouncements(asAuth(asistente))).toHaveLength(0);
      await expect(service.comments(asAuth(asistente), interno.id)).rejects.toThrow(/not found/);
      await expect(service.react(asAuth(asistente), interno.id, 'LIKE')).rejects.toThrow(
        /not found/,
      );

      const forMiembro = await service.feed(asAuth(miembro), { first: 10 });
      expect(forMiembro.edges.map((e) => e.node.id)).toEqual([interno.id, publico.id]);
      expect(forMiembro.edges[0].node.membersOnly).toBe(true);
    });

    it('filters the feed by audience; asistentes never get internal posts', async () => {
      const publico = await service.createPost(asAuth(pastor), { body: 'para todos' });
      const interno = await service.createPost(asAuth(pastor), {
        body: 'solo miembros',
        membersOnly: true,
      });
      const ids = async (who: User, audience: FeedAudience) =>
        (await service.feed(asAuth(who), { first: 10 }, audience)).edges.map((e) => e.node.id);

      expect(await ids(miembro, FeedAudience.ALL)).toEqual([interno.id, publico.id]);
      expect(await ids(miembro, FeedAudience.MEMBERS_ONLY)).toEqual([interno.id]);
      expect(await ids(miembro, FeedAudience.EVERYONE)).toEqual([publico.id]);
      expect(await ids(asistente, FeedAudience.MEMBERS_ONLY)).toEqual([]);
      expect(await ids(asistente, FeedAudience.ALL)).toEqual([publico.id]);
    });

    it('paginates newest first without repeating posts', async () => {
      const created: string[] = [];
      for (let i = 0; i < 5; i++) {
        created.push((await service.createPost(asAuth(pastor), { body: `post ${i}` })).id);
      }
      const page1 = await service.feed(asAuth(miembro), { first: 2 });
      const page2 = await service.feed(asAuth(miembro), {
        first: 2,
        after: page1.pageInfo.endCursor!,
      });
      const page3 = await service.feed(asAuth(miembro), {
        first: 2,
        after: page2.pageInfo.endCursor!,
      });

      const seen = [...page1.edges, ...page2.edges, ...page3.edges].map((e) => e.node.id);
      expect(seen).toEqual([...created].reverse());
      expect(page3.pageInfo.hasNextPage).toBe(false);
    });

    it('anyone, asistentes included, can comment and react on what they see', async () => {
      const post = await service.createPost(asAuth(pastor), { body: 'para todos' });

      await service.react(asAuth(asistente), post.id, 'AMEN');
      await service.addComment(asAuth(asistente), { postId: post.id, body: '¡Amén!' });

      expect(await service.myReaction(asistente.id, post.id)).toBe('AMEN');
      expect(await service.commentCount(post.id)).toBe(1);
    });
  });
});
