import { Global, Module } from '@nestjs/common';
import { NotificationsResolver } from './notifications.resolver';
import { NotificationsService } from './notifications.service';

/** Global: cualquier módulo puede avisar con `notifications.notify(...)`. */
@Global()
@Module({
  providers: [NotificationsService, NotificationsResolver],
  exports: [NotificationsService],
})
export class NotificationsModule {}
