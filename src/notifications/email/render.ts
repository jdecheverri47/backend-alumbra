/** Lo que hace falta para escribir el correo de un aviso. */
export interface EmailContent {
  title: string;
  body: string | null;
  href: string | null;
  /** "Nota publicada", "Registro asignado"…: el tipo, para el pie. */
  typeLabel: string;
  firstName: string;
  appUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Dónde apagar este tipo de correo (también va en List-Unsubscribe). */
  preferencesUrl: string;
}

// Los colores de la marca (frontend/app/globals.css).
const INK = '#23221f';
const CLAY = '#6e5240';
const ROSE = '#b29079';
const CREAM = '#f4f3f0';
const MUTED = '#6b6862';

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const absolute = (appUrl: string, href: string) =>
  /^https?:\/\//.test(href) ? href : `${appUrl.replace(/\/$/, '')}${href}`;

/**
 * El correo de un aviso: el mismo título y texto que en la campana, un botón
 * a la app y un pie para apagar ese tipo. HTML con tablas y estilos en línea,
 * que es lo que entienden todos los clientes de correo; y su versión en texto.
 */
export function renderEmail(c: EmailContent): RenderedEmail {
  const app = c.appUrl.replace(/\/$/, '');
  const link = absolute(app, c.href ?? '/notificaciones');
  const preferencesUrl = `${app}/notificaciones/preferencias`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escape(c.title)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
    <tr><td style="padding:0 8px 20px;">
      <img src="${app}/logo-alumbra-negro.png" width="96" height="39" alt="Alumbra" style="display:block;border:0;">
    </td></tr>
    <tr><td style="background:#ffffff;border-radius:16px;padding:32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
      <p style="margin:0 0 12px;font-size:15px;color:${MUTED};">Hola, ${escape(c.firstName)}:</p>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;font-weight:600;color:${INK};">${escape(c.title)}</h1>
      ${c.body ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:${INK};">${escape(c.body)}</p>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="border-radius:999px;background:${CLAY};">
          <a href="${escape(link)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Ver en Alumbra</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:20px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">
      Te escribimos porque tienes activados los correos de “${escape(c.typeLabel)}”.
      <a href="${escape(preferencesUrl)}" style="color:${ROSE};">Cambiar qué correos recibo</a>.<br>
      Iglesia Alumbra · Barranquilla
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Hola, ${c.firstName}:`,
    '',
    c.title,
    ...(c.body ? ['', c.body] : []),
    '',
    `Ver en Alumbra: ${link}`,
    '',
    '—',
    `Te escribimos porque tienes activados los correos de "${c.typeLabel}".`,
    `Cambiar qué correos recibo: ${preferencesUrl}`,
  ].join('\n');

  return { subject: c.title, html, text, preferencesUrl };
}
