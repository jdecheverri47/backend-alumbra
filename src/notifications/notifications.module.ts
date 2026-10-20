import { Global, Module } from '@nestjs/common';
import { NotificationsResolver } from './notifications.resolver';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { NotificationsService } from './notifications.service';

/** Global: cualquier módulo puede avisar con `notifications.notify(...)`. */
@Global()
@Module({
  controllers: [RemindersController],
  providers: [NotificationsService, NotificationsResolver, RemindersService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
