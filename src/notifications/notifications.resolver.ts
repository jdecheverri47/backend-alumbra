import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PaginationInput } from '../common/pagination/pagination.input';
import { NotificationConnection, NotificationModel } from './dto/notification.model';
import { NotificationsService } from './notifications.service';

/** La campana: cada quien ve y marca solo sus propios avisos. */
@Resolver(() => NotificationModel)
export class NotificationsResolver {
  constructor(private readonly service: NotificationsService) {}

  @Query(() => NotificationConnection, { description: 'Mis avisos, lo más reciente primero.' })
  notifications(
    @CurrentUser() me: AuthenticatedUser,
    @Args('page', { nullable: true }) page?: PaginationInput,
  ): Promise<NotificationConnection> {
    return this.service.list(me.sub, page ?? new PaginationInput());
  }

  @Query(() => Int)
  unreadNotificationCount(@CurrentUser() me: AuthenticatedUser): Promise<number> {
    return this.service.unreadCount(me.sub);
  }

  @Mutation(() => Boolean)
  markNotificationRead(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.service.markRead(me.sub, id);
  }

  @Mutation(() => Int, { description: 'Marca todas como leídas; devuelve cuántas.' })
  markAllNotificationsRead(@CurrentUser() me: AuthenticatedUser): Promise<number> {
    return this.service.markAllRead(me.sub);
  }
}
