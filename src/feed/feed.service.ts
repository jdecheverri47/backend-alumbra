import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PostComment, ReactionType, User } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../common/pagination/encode-cursor';
import { PaginationInput } from '../common/pagination/pagination.input';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { addCommentSchema, createPostSchema } from './dto/inputs.schema';
import { PostConnection } from './dto/post.model';
import { POST_INCLUDE, PostRow, toPostModel } from './dto/to-post-model';

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pastores, líderes designados, líderes de grupo y líderes de ministerio pueden publicar. */
  async canPost(me: AuthenticatedUser): Promise<boolean> {
    if (me.isPastor || me.user.isLeader) return true;
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
        eventId: data.eventId,
        images: {
          create: data.imageUrls.map((url, position) => ({ url, position })),
        },
      },
      include: POST_INCLUDE,
    });
  }

  async feed(page: PaginationInput): Promise<PostConnection> {
    const first = Math.max(1, Math.min(50, page.first ?? 20));
    const rows = await this.prisma.post.findMany({
      where: { deletedAt: null },
      include: POST_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: first + 1,
      ...(page.after ? { cursor: { id: decodeCursor(page.after) }, skip: 1 } : {}),
    });

    const hasNextPage = rows.length > first;
    const slice = rows.slice(0, first);
    return {
      edges: slice.map((post) => ({ node: toPostModel(post), cursor: encodeCursor(post.id) })),
      pageInfo: {
        hasNextPage,
        endCursor: slice.length ? encodeCursor(slice[slice.length - 1].id) : null,
      },
    };
  }

  async pinnedAnnouncements(): Promise<PostRow[]> {
    return this.prisma.post.findMany({
      where: { deletedAt: null, pinnedAt: { not: null } },
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
    const post = await this.findByIdOrThrow(postId);
    await this.prisma.postReaction.upsert({
      where: { postId_userId: { postId, userId: me.sub } },
      create: { postId, userId: me.sub, type },
      update: { type },
    });
    return post;
  }

  async removeReaction(me: AuthenticatedUser, postId: string): Promise<PostRow> {
    const post = await this.findByIdOrThrow(postId);
    await this.prisma.postReaction.deleteMany({ where: { postId, userId: me.sub } });
    return post;
  }

  async addComment(me: AuthenticatedUser, raw: unknown): Promise<PostComment & { author: User }> {
    const { postId, body } = addCommentSchema.parse(raw);
    await this.findByIdOrThrow(postId);
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

  async comments(postId: string): Promise<Array<PostComment & { author: User }>> {
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

  private async findByIdOrThrow(id: string): Promise<PostRow> {
    const post = await this.prisma.post.findUnique({ where: { id }, include: POST_INCLUDE });
    if (!post || post.deletedAt) throw new NotFoundException(`Post ${id} not found.`);
    return post;
  }
}
