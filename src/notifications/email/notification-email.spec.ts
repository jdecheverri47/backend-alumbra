import { Test } from '@nestjs/testing';
import { FakeMailer, notificationProviders } from '../../../test/setup/notification-providers';
import { requireLocalDb } from '../../../test/setup/require-local-db';
import { wipeDb } from '../../../test/setup/wipe-db';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications.service';
import { NotificationEmailService } from './notification-email.service';
import { renderEmail } from './render';

describe('Correo de los avisos', () => {
  let notifications: NotificationsService;
  let email: NotificationEmailService;
  let prisma: PrismaService;
  const mailer = new FakeMailer();
  let ana: string;

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [...notificationProviders(mailer), PrismaService],
    }).compile();
    notifications = moduleRef.get(NotificationsService);
    email = moduleRef.get(NotificationEmailService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await wipeDb(prisma);
    mailer.sent = [];
    mailer.fail = false;
    ana = (
      await prisma.user.create({
        data: { email: 'ana@alumbra.test', firstName: 'Ana', lastName: 'P', canSignIn: true },
      })
    ).id;
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
  });

  const status = async () =>
    (await prisma.notification.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (n) => `${n.type}:${n.emailStatus}`,
    );

  it('manda por correo lo que el catálogo dice; lo demás, solo a la campana', async () => {
    await notifications.notify({
      type: 'instituto.nota.publicada',
      to: [ana],
      title: 'Tienes nota en "Ensayo"',
      body: '18 / 20',
      href: '/instituto?item=x',
    });
    await notifications.notify({ type: 'muro.anuncio.nuevo', to: [ana], title: 'Anuncio' });

    expect(await status()).toEqual(['instituto.nota.publicada:SENT', 'muro.anuncio.nuevo:NONE']);
    expect(mailer.sent).toHaveLength(1);
    const [sent] = mailer.sent;
    expect(sent).toMatchObject({
      to: 'ana@alumbra.test',
      subject: 'Tienes nota en "Ensayo"',
      unsubscribeUrl: 'http://localhost:3000/notificaciones/preferencias',
    });
    expect(sent.text).toContain('Hola, Ana:');
    expect(sent.text).toContain('Ver en Alumbra: http://localhost:3000/instituto?item=x');
    expect(sent.html).toContain('Nota publicada');
  });

  it('respeta lo que cada quien apagó o prendió', async () => {
    await notifications.setPreference(ana, 'instituto.nota.publicada', false);
    await notifications.setPreference(ana, 'muro.anuncio.nuevo', true);

    await notifications.notify({ type: 'instituto.nota.publicada', to: [ana], title: 'Nota' });
    await notifications.notify({ type: 'muro.anuncio.nuevo', to: [ana], title: 'Anuncio' });

    expect(await status()).toEqual(['instituto.nota.publicada:NONE', 'muro.anuncio.nuevo:SENT']);
    const prefs = await notifications.preferences(ana);
    expect(prefs.find((p) => p.type === 'instituto.nota.publicada')).toMatchObject({
      email: false,
      emailByDefault: true,
      module: 'Instituto',
    });
    await expect(notifications.setPreference(ana, 'no.existe', true)).rejects.toThrow(
      /desconocido/,
    );
  });

  it('si Resend falla, reintenta después y se rinde al tercer intento', async () => {
    mailer.fail = true;
    await notifications.notify({ type: 'acogida.asignacion', to: [ana], title: 'Asignada' });
    expect(await status()).toEqual(['acogida.asignacion:PENDING']);

    await email.sendPending();
    await email.sendPending();
    expect(await status()).toEqual(['acogida.asignacion:FAILED']);

    // Si vuelve antes del tercer intento, sale.
    await notifications.notify({ type: 'acogida.asignacion', to: [ana], title: 'Otra' });
    mailer.fail = false;
    expect(await email.sendPending()).toBe(1);
    expect(mailer.sent.map((e) => e.subject)).toEqual(['Otra']);
  });

  it('apagar un tipo cancela lo que quedó pendiente de ese tipo', async () => {
    mailer.fail = true;
    await notifications.notify({ type: 'acogida.asignacion', to: [ana], title: 'Asignada' });
    await notifications.setPreference(ana, 'acogida.asignacion', false);
    mailer.fail = false;

    expect(await email.sendPending()).toBe(0);
    expect(await status()).toEqual(['acogida.asignacion:NONE']);
  });
});

describe('renderEmail', () => {
  it('escapa lo que escribió la gente y arma enlaces absolutos', () => {
    const e = renderEmail({
      title: 'Comentario <b>raro</b> & "comillas"',
      body: '<script>alert(1)</script>',
      href: '/muro',
      typeLabel: 'Comentario en tu publicación',
      firstName: 'Ana',
      appUrl: 'https://iglesiaalumbra.org/',
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).toContain('href="https://iglesiaalumbra.org/muro"');
    expect(e.preferencesUrl).toBe('https://iglesiaalumbra.org/notificaciones/preferencias');
  });
});
