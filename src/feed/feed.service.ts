import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PostComment, Prisma, ReactionType, User } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../common/pagination/encode-cursor';
import { PaginationInput } from '../common/pagination/pagination.input';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { canSeeMembersOnly } from '../events/event-visibility';
import { addCommentSchema, createPostSchema, votePollSchema } from './dto/inputs.schema';
import { PollModel } from './dto/poll.model';
import { FeedAudience } from './dto/feed-audience.enum';
import { PostConnection } from './dto/post.model';
import { POST_INCLUDE, PostRow, toPostModel } from './dto/to-post-model';

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Publican pastores, líderes designados, líderes de grupo y líderes de
   * ministerio (coordinadores). Un asistente nunca, aunque dirija un grupo.
   * Comentar y reaccionar sí lo puede hacer cualquiera.
   */
  async canPost(me: AuthenticatedUser): Promise<boolean> {
    if (me.isPastor) return true;
    if (me.baseRole === 'ASISTENTE') return false;
    if (me.user.isLeader) return true;
    const [ledGroup, ledMinistry] = await Promise.all([
      this.prisma.group.findFirst({ where: { leaderId: me.sub, archivedAt: null } }),
      this.prisma.ministryMembership.findFirst({
        where: { userId: me.sub, role: 'LEADER', leftAt: null },
      }),
    ]);
    return Boolean(ledGroup || ledMinistry);
  }

  async createPost(me: AuthenticatedUser, raw: unknown): Promise<PostRow> {
    const data = createPostSchema.parse(raw);

    if (data.type === 'ANUNCIO') {
      if (!me.isPastor) {
        throw new ForbiddenException({
          error: 'FORBIDDEN',
          message: 'Solo los pastores pueden publicar anuncios.',
        });
      }
    } else if (!(await this.canPost(me))) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo pastores y líderes pueden publicar en el feed.',
      });
    }

    if (data.eventId) {
      const event = await this.prisma.event.findUnique({ where: { id: data.eventId } });
      if (!event) throw new NotFoundException(`Event ${data.eventId} not found.`);
    }

    return this.prisma.post.create({
      data: {
        authorId: me.sub,
        type: data.type,
        body: data.body,
        membersOnly: data.membersOnly,
        eventId: data.eventId,
        images: {
          create: data.imageUrls.map((url, position) => ({ url, position })),
        },
        ...(data.poll
          ? {
              poll: {
                create: {
                  closesAt: data.poll.durationHours
                    ? new Date(Date.now() + data.poll.durationHours * 3600 * 1000)
                    : null,
                  options: {
                    create: data.poll.options.map((text, position) => ({ text, position })),
                  },
                },
              },
            }
          : {}),
      },
      include: POST_INCLUDE,
    });
  }

  /** La encuesta del post con sus conteos y lo que votó `viewerId`; null si no tiene. */
  async pollFor(postId: string, viewerId: string): Promise<PollModel | null> {
    const poll = await this.prisma.postPoll.findUnique({
      where: { postId },
      include: {
        options: {
          orderBy: { position: 'asc' },
          include: { _count: { select: { votes: true } } },
        },
        votes: { where: { userId: viewerId }, select: { optionId: true } },
      },
    });
    if (!poll) return null;

    const options = poll.options.map((o) => ({ id: o.id, text: o.text, votes: o._count.votes }));
    return {
      id: poll.id,
      options,
      totalVotes: options.reduce((sum, o) => sum + o.votes, 0),
      myVoteOptionId: poll.votes[0]?.optionId ?? null,
      closesAt: poll.closesAt,
      isClosed: poll.closesAt !== null && poll.closesAt <= new Date(),
    };
  }

  /** Un voto por persona y no se cambia, como en X/Twitter. */
  async votePoll(me: AuthenticatedUser, raw: unknown): Promise<PollModel> {
    const { optionId } = votePollSchema.parse(raw);
    const option = await this.prisma.postPollOption.findUnique({
      where: { id: optionId },
      include: { poll: { include: { post: true } } },
    });
    if (
      !option ||
      option.poll.post.deletedAt ||
      (option.poll.post.membersOnly && !canSeeMembersOnly(me))
    ) {
      throw new NotFoundException(`Poll option ${optionId} not found.`);
    }
    const { poll } = option;
    if (poll.closesAt && poll.closesAt <= new Date()) {
      throw new BadRequestException({ error: 'POLL_CLOSED', message: 'La encuesta ya cerró.' });
    }

    try {
      await this.prisma.postPollVote.create({
        data: { pollId: poll.id, optionId, userId: me.sub },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          error: 'ALREADY_VOTED',
          message: 'Ya votaste en esta encuesta.',
        });
      }
      throw e;
    }

    return (await this.pollFor(poll.postId, me.sub))!;
  }

  async feed(
    me: AuthenticatedUser,
    page: PaginationInput,
    audience: FeedAudience = FeedAudience.ALL,
  ): Promise<PostConnection> {
    const first = Math.max(1, Math.min(50, page.first ?? 20));
    const rows = await this.prisma.post.findMany({
      where: { deletedAt: null, ...this.visibleTo(me, audience) },
      include: POST_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: first + 1,
      ...(page.after ? { cursor: { id: decodeCursor(page.after) }, skip: 1 } : {}),
    });

    const hasNextPage = rows.length > first;
    const slice = rows.slice(0, first);
    return {
      edges: slice.map((post) => ({ node: toPostModel(post, me), cursor: encodeCursor(post.id) })),
      pageInfo: {
        hasNextPage,
        endCursor: slice.length ? encodeCursor(slice[slice.length - 1].id) : null,
      },
    };
  }

  async pinnedAnnouncements(
    me: AuthenticatedUser,
    audience: FeedAudience = FeedAudience.ALL,
  ): Promise<PostRow[]> {
    return this.prisma.post.findMany({
      where: { deletedAt: null, pinnedAt: { not: null }, ...this.visibleTo(me, audience) },
      include: POST_INCLUDE,
      orderBy: { pinnedAt: 'desc' },
    });
  }

  async setPinned(id: string, pinned: boolean): Promise<PostRow> {
    const post = await this.findByIdOrThrow(id);
    if (post.type !== 'ANUNCIO') {
      throw new BadRequestException('Solo los anuncios se pueden fijar.');
    }
    return this.prisma.post.update({
      where: { id },
      data: { pinnedAt: pinned ? new Date() : null },
      include: POST_INCLUDE,
    });
  }

  async deletePost(me: AuthenticatedUser, id: string): Promise<PostRow> {
    const post = await this.findByIdOrThrow(id);
    if (!me.isPastor && post.authorId !== me.sub) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo el autor o un pastor puede eliminar el post.',
      });
    }
    return this.prisma.post.update({
      where: { id },
      data: { deletedAt: new Date(), pinnedAt: null },
      include: POST_INCLUDE,
    });
  }

  async react(me: AuthenticatedUser, postId: string, type: ReactionType): Promise<PostRow> {
    const post = await this.findByIdOrThrow(postId, me);
    await this.prisma.postReaction.upsert({
      where: { postId_userId: { postId, userId: me.sub } },
      create: { postId, userId: me.sub, type },
      update: { type },
    });
    return post;
  }

  async removeReaction(me: AuthenticatedUser, postId: string): Promise<PostRow> {
    const post = await this.findByIdOrThrow(postId, me);
    await this.prisma.postReaction.deleteMany({ where: { postId, userId: me.sub } });
    return post;
  }

  async addComment(me: AuthenticatedUser, raw: unknown): Promise<PostComment & { author: User }> {
    const { postId, body } = addCommentSchema.parse(raw);
    await this.findByIdOrThrow(postId, me);
    return this.prisma.postComment.create({
      data: { postId, authorId: me.sub, body },
      include: { author: true },
    });
  }

  async deleteComment(me: AuthenticatedUser, id: string): Promise<PostComment & { author: User }> {
    const comment = await this.prisma.postComment.findUnique({
      where: { id },
      include: { author: true, post: true },
    });
    if (!comment || comment.deletedAt) throw new NotFoundException(`Comment ${id} not found.`);
    const mayDelete =
      me.isPastor || comment.authorId === me.sub || comment.post.authorId === me.sub;
    if (!mayDelete) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo el autor del comentario, el autor del post o un pastor puede eliminarlo.',
      });
    }
    return this.prisma.postComment.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: { author: true },
    });
  }

  async comments(
    me: AuthenticatedUser,
    postId: string,
  ): Promise<Array<PostComment & { author: User }>> {
    await this.findByIdOrThrow(postId, me);
    return this.prisma.postComment.findMany({
      where: { postId, deletedAt: null },
      include: { author: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async reactionCounts(postId: string): Promise<Array<{ type: ReactionType; count: number }>> {
    const grouped = await this.prisma.postReaction.groupBy({
      by: ['type'],
      where: { postId },
      _count: { _all: true },
    });
    return grouped.map((g) => ({ type: g.type, count: g._count._all }));
  }

  async myReaction(userId: string, postId: string): Promise<ReactionType | null> {
    const reaction = await this.prisma.postReaction.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    return reaction?.type ?? null;
  }

  async commentCount(postId: string): Promise<number> {
    return this.prisma.postComment.count({ where: { postId, deletedAt: null } });
  }

  /** Con `me`, un post interno que no puede ver cuenta como inexistente. */
  private async findByIdOrThrow(id: string, me?: AuthenticatedUser): Promise<PostRow> {
    const post = await this.prisma.post.findUnique({ where: { id }, include: POST_INCLUDE });
    const hidden = me && post?.membersOnly && !canSeeMembersOnly(me);
    if (!post || post.deletedAt || hidden) throw new NotFoundException(`Post ${id} not found.`);
    return post;
  }

  /**
   * Los posts internos solo los ven miembros y pastores; sobre eso se aplica el
   * filtro del feed. Un asistente que pida MEMBERS_ONLY se queda sin nada, no
   * con los públicos.
   */
  private visibleTo(
    me: AuthenticatedUser,
    audience: FeedAudience = FeedAudience.ALL,
  ): { membersOnly?: boolean; id?: { in: [] } } {
    if (!canSeeMembersOnly(me)) {
      return audience === FeedAudience.MEMBERS_ONLY ? { id: { in: [] } } : { membersOnly: false };
    }
    if (audience === FeedAudience.MEMBERS_ONLY) return { membersOnly: true };
    if (audience === FeedAudience.EVERYONE) return { membersOnly: false };
    return {};
  }
}
