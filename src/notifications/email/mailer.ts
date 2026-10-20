import { Logger } from '@nestjs/common';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** URL para darse de baja (encabezado List-Unsubscribe). */
  unsubscribeUrl: string;
}

/** Manda una tanda de correos: o salen todos, o lanza. */
export interface Mailer {
  sendBatch(emails: OutgoingEmail[]): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/** Resend acepta hasta 100 correos por llamada a /emails/batch. */
export const BATCH_SIZE = 100;

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo: string,
  ) {}

  async sendBatch(emails: OutgoingEmail[]): Promise<void> {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        emails.map((e) => ({
          from: this.from,
          to: [e.to],
          reply_to: this.replyTo,
          subject: e.subject,
          html: e.html,
          text: e.text,
          headers: { 'List-Unsubscribe': `<${e.unsubscribeUrl}>` },
        })),
      ),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`Resend respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  }
}

/** Sin API key (desarrollo, tests): el correo se escribe en el log. */
export class LogMailer implements Mailer {
  private readonly logger = new Logger('Correo');

  async sendBatch(emails: OutgoingEmail[]): Promise<void> {
    for (const e of emails) {
      this.logger.log(`Para ${e.to} · ${e.subject}\n${e.text}`);
    }
  }
}
