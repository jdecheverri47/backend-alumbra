import { Args, ID, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePastor } from '../auth/decorators/require-pastor.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PaginationInput } from '../common/pagination/pagination.input';
import { CreatePostInput } from './dto/create-post.input';
import {
  FeedPermissionsModel,
  PostCommentModel,
  PostConnection,
  PostModel,
  ReactionCountModel,
} from './dto/post.model';
import { ReactionType } from './dto/reaction-type.enum';
import { toPostCommentModel, toPostModel } from './dto/to-post-model';
import { FeedService } from './feed.service';

@Resolver(() => PostModel)
export class FeedResolver {
  constructor(private readonly feedService: FeedService) {}

  @Query(() => PostConnection, { description: 'Feed principal, más reciente primero.' })
  async feed(
    @CurrentUser() me: AuthenticatedUser,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<PostConnection> {
    return this.feedService.feed(me, pagination ?? { first: 20 });
  }

  @Query(() => [PostModel], { description: 'Anuncios fijados, para mostrar arriba del feed.' })
  async pinnedAnnouncements(@CurrentUser() me: AuthenticatedUser): Promise<PostModel[]> {
    const rows = await this.feedService.pinnedAnnouncements();
    return rows.map((post) => toPostModel(post, me));
  }

  @Query(() => FeedPermissionsModel)
  async myFeedPermissions(@CurrentUser() me: AuthenticatedUser): Promise<FeedPermissionsModel> {
    return {
      canPost: await this.feedService.canPost(me),
      canAnnounce: me.isPastor,
    };
  }

  @Query(() => [PostCommentModel], { description: 'Comentarios de un post, más antiguo primero.' })
  async postComments(
    @Args('postId', { type: () => ID }) postId: string,
  ): Promise<PostCommentModel[]> {
    const rows = await this.feedService.comments(postId);
    return rows.map(toPostCommentModel);
  }

  // Pastor o líder (validado en el service); ANUNCIO solo pastores.
  @Mutation(() => PostModel)
  async createPost(
    @Args('input') input: CreatePostInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<PostModel> {
    return toPostModel(await this.feedService.createPost(me, input), me);
  }

  // Autor o pastor (validado en el service).
  @Mutation(() => PostModel)
  async deletePost(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<PostModel> {
    return toPostModel(await this.feedService.deletePost(me, id), me);
  }

  @RequirePastor()
  @Mutation(() => PostModel)
  async setPostPinned(
    @Args('id', { type: () => ID }) id: string,
    @Args('pinned') pinned: boolean,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<PostModel> {
    return toPostModel(await this.feedService.setPinned(id, pinned), me);
  }

  @Mutation(() => PostModel, { description: 'Crea o reemplaza mi reacción al post.' })
  async reactToPost(
    @Args('postId', { type: () => ID }) postId: string,
    @Args('type', { type: () => ReactionType }) type: ReactionType,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<PostModel> {
    return toPostModel(await this.feedService.react(me, postId, type), me);
  }

  @Mutation(() => PostModel)
  async removePostReaction(
    @Args('postId', { type: () => ID }) postId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<PostModel> {
    return toPostModel(await this.feedService.removeReaction(me, postId), me);
  }

  @Mutation(() => PostCommentModel)
  async addPostComment(
    @Args('postId', { type: () => ID }) postId: string,
    @Args('body') body: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<PostCommentModel> {
    return toPostCommentModel(await this.feedService.addComment(me, { postId, body }));
  }

  // Autor del comentario, autor del post o pastor (validado en el service).
  @Mutation(() => PostCommentModel)
  async deletePostComment(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<PostCommentModel> {
    return toPostCommentModel(await this.feedService.deleteComment(me, id));
  }

  @ResolveField(() => [ReactionCountModel])
  async reactionCounts(@Parent() post: PostModel): Promise<ReactionCountModel[]> {
    return this.feedService.reactionCounts(post.id);
  }

  @ResolveField(() => ReactionType, { nullable: true })
  async myReaction(
    @Parent() post: PostModel,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<ReactionType | null> {
    return this.feedService.myReaction(me.sub, post.id);
  }

  @ResolveField(() => Int)
  async commentCount(@Parent() post: PostModel): Promise<number> {
    return this.feedService.commentCount(post.id);
  }
}
