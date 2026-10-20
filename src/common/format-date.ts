// Fechas para textos que lee la gente (avisos, correos), en hora de Colombia:
// el servidor corre en UTC.
const TIME_ZONE = 'America/Bogota';

/** "24 oct." */
export function formatDay(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    timeZone: TIME_ZONE,
  }).format(d);
}

/** "lunes, 3 de noviembre, 7:00 p. m." */
export function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  }).format(d);
}
