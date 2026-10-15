import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { EventModel } from '../../events/dto/event.model';
import { UserModel } from '../../users/dto/user.model';
import { PageInfo } from '../../common/pagination/page-info.type';
import { PostMediaKind } from './post-media-kind.enum';
import { PostType } from './post-type.enum';
import { ReactionType } from './reaction-type.enum';

@ObjectType('PostImage')
export class PostImageModel {
  @Field(() => ID)
  id!: string;

  @Field()
  url!: string;

  @Field(() => PostMediaKind)
  kind!: PostMediaKind;

  @Field(() => Int)
  position!: number;
}

@ObjectType('ReactionCount')
export class ReactionCountModel {
  @Field(() => ReactionType)
  type!: ReactionType;

  @Field(() => Int)
  count!: number;
}

@ObjectType('Post')
export class PostModel {
  @Field(() => ID)
  id!: string;

  @Field(() => PostType)
  type!: PostType;

  @Field()
  body!: string;

  @Field(() => UserModel)
  author!: UserModel;

  @Field(() => EventModel, { nullable: true })
  event?: EventModel | null;

  @Field(() => [PostImageModel])
  images!: PostImageModel[];

  @Field(() => Date, { nullable: true })
  pinnedAt?: Date | null;

  @Field({ description: 'Interno: solo lo ven miembros y pastores.' })
  membersOnly!: boolean;

  @Field(() => Date)
  createdAt!: Date;

  // reactionCounts, myReaction y commentCount se resuelven como field resolvers.
}

@ObjectType('PostComment')
export class PostCommentModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  author!: UserModel;

  @Field()
  body!: string;

  @Field(() => Date)
  createdAt!: Date;
}

@ObjectType('PostEdge')
export class PostEdge {
  @Field(() => PostModel)
  node!: PostModel;

  @Field()
  cursor!: string;
}

@ObjectType('PostConnection')
export class PostConnection {
  @Field(() => [PostEdge])
  edges!: PostEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;
}

@ObjectType('FeedPermissions')
export class FeedPermissionsModel {
  @Field(() => Boolean, { description: 'Puede publicar posts (pastor o líder).' })
  canPost!: boolean;

  @Field(() => Boolean, { description: 'Puede publicar anuncios y fijarlos (pastor).' })
  canAnnounce!: boolean;

  @Field(() => Boolean, {
    description: 'Ve las publicaciones internas (miembro o pastor): decide si hay filtro.',
  })
  canSeeMembersOnly!: boolean;
}
