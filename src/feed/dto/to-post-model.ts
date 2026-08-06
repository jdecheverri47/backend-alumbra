import { Event, Group, Post, PostComment, PostImage, User } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { toEventModel } from '../../events/dto/to-event-model';
import { canSeeMembersOnly } from '../../events/event-visibility';
import { toUserModel } from '../../users/dto/to-user-model';
import { PostCommentModel, PostModel } from './post.model';

export type PostRow = Post & {
  author: User;
  images: PostImage[];
  event: (Event & { createdBy: User; group: (Group & { leader: User }) | null }) | null;
};

export const POST_INCLUDE = {
  author: true,
  images: { orderBy: { position: 'asc' as const } },
  event: { include: { createdBy: true, group: { include: { leader: true } } } },
};

/**
 * `viewer` es obligatorio a propósito: un post puede colgar de un evento de
 * miembros, y sin saber quién mira no se puede decidir si mostrarlo.
 */
export function toPostModel(post: PostRow, viewer: AuthenticatedUser): PostModel {
  const event = post.event?.membersOnly && !canSeeMembersOnly(viewer) ? null : post.event;

  return {
    id: post.id,
    type: post.type,
    body: post.body,
    author: toUserModel(post.author),
    event: event ? toEventModel(event) : null,
    images: post.images.map((i) => ({ id: i.id, url: i.url, position: i.position })),
    pinnedAt: post.pinnedAt,
    createdAt: post.createdAt,
  };
}

export function toPostCommentModel(comment: PostComment & { author: User }): PostCommentModel {
  return {
    id: comment.id,
    author: toUserModel(comment.author),
    body: comment.body,
    createdAt: comment.createdAt,
  };
}
