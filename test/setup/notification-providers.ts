import { ConfigService } from '@nestjs/config';
import { Mailer, MAILER, OutgoingEmail } from '../../src/notifications/email/mailer';
import { NotificationEmailService } from '../../src/notifications/email/notification-email.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Un correo de mentira: guarda lo que "mandó" para revisarlo en la prueba. */
export class FakeMailer implements Mailer {
  sent: OutgoingEmail[] = [];
  fail = false;

  async sendBatch(emails: OutgoingEmail[]): Promise<void> {
    if (this.fail) throw new Error('Resend caído');
    this.sent.push(...emails);
  }
}

/**
 * Lo que necesita NotificationsService en una prueba unitaria, con el correo
 * falso y sin ConfigService (los enlaces van a http://localhost:3000).
 */
export function notificationProviders(mailer: Mailer = new FakeMailer()) {
  return [
    NotificationsService,
    { provide: MAILER, useValue: mailer },
    {
      provide: NotificationEmailService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new NotificationEmailService(
          prisma,
          { get: () => undefined } as unknown as ConfigService,
          mailer,
        ),
    },
  ];
}
