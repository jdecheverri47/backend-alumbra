import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogMailer, MAILER, ResendMailer } from './email/mailer';
import { NotificationEmailService } from './email/notification-email.service';
import { NotificationsResolver } from './notifications.resolver';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { NotificationsService } from './notifications.service';

/** Global: cualquier módulo puede avisar con `notifications.notify(...)`. */
@Global()
@Module({
  controllers: [RemindersController],
  providers: [
    NotificationsService,
    NotificationsResolver,
    RemindersService,
    NotificationEmailService,
    {
      // Con API key, Resend; sin ella (desarrollo, tests), al log.
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const key = config.get<string>('RESEND_API_KEY');
        return key
          ? new ResendMailer(
              key,
              config.getOrThrow<string>('EMAIL_FROM'),
              config.getOrThrow<string>('EMAIL_REPLY_TO'),
            )
          : new LogMailer();
      },
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
