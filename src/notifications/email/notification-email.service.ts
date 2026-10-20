import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseOrigins } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICATION_TYPES, NotificationType } from '../catalog';
import { BATCH_SIZE, MAILER, Mailer } from './mailer';
import { renderEmail } from './render';

/** Tras estos intentos fallidos, el correo se da por perdido (el aviso sigue en la campana). */
export const MAX_ATTEMPTS = 3;
/** Un correo que no salió en este tiempo ya no vale la pena: llegaría tarde. */
const STALE_MS = 3 * 24 * 60 * 60 * 1000;
/** Resend admite 2 llamadas por segundo en el plan gratuito. */
const PAUSE_MS = 600;
const MAX_PER_RUN = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Manda por correo los avisos marcados PENDING. Se llama justo después de
 * crearlos y otra vez en cada pasada de los recordatorios, que reintenta los
 * que fallaron.
 */
@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {
    this.appUrl =
      config.get<string>('APP_URL') ??
      parseOrigins(config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000')[0];
  }

  /** Correos por mandar; con `ids`, solo esos avisos. Devuelve cuántos salieron. */
  async sendPending(ids?: string[]): Promise<number> {
    if (ids?.length === 0) return 0;
    const now = Date.now();
    const rows = await this.prisma.notification.findMany({
      where: { emailStatus: 'PENDING', ...(ids ? { id: { in: ids } } : {}) },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_PER_RUN,
    });

    const unsendable = rows.filter(
      (n) => n.user.deletedAt || !n.user.email || now - n.createdAt.getTime() > STALE_MS,
    );
    if (unsendable.length) {
      await this.prisma.notification.updateMany({
        where: { id: { in: unsendable.map((n) => n.id) } },
        data: { emailStatus: 'FAILED' },
      });
    }
    const sendable = rows.filter((n) => !unsendable.includes(n));

    let sent = 0;
    for (let i = 0; i < sendable.length; i += BATCH_SIZE) {
      if (i > 0) await sleep(PAUSE_MS);
      const batch = sendable.slice(i, i + BATCH_SIZE);
      try {
        await this.mailer.sendBatch(
          batch.map((n) => {
            const email = renderEmail({
              title: n.title,
              body: n.body,
              href: n.href,
              typeLabel: NOTIFICATION_TYPES[n.type as NotificationType]?.label ?? 'Avisos',
              firstName: n.user.firstName,
              appUrl: this.appUrl,
            });
            return {
              to: n.user.email,
              subject: email.subject,
              html: email.html,
              text: email.text,
              unsubscribeUrl: email.preferencesUrl,
            };
          }),
        );
        await this.prisma.notification.updateMany({
          where: { id: { in: batch.map((n) => n.id) } },
          data: { emailStatus: 'SENT', emailedAt: new Date(), emailAttempts: { increment: 1 } },
        });
        sent += batch.length;
      } catch (e) {
        this.logger.error(`No salieron ${batch.length} correos`, e as Error);
        await this.prisma.notification.updateMany({
          where: { id: { in: batch.map((n) => n.id) } },
          data: { emailAttempts: { increment: 1 } },
        });
        await this.prisma.notification.updateMany({
          where: {
            id: { in: batch.map((n) => n.id) },
            emailAttempts: { gte: MAX_ATTEMPTS },
          },
          data: { emailStatus: 'FAILED' },
        });
      }
    }
    return sent;
  }
}
