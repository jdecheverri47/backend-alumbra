/**
 * Los tipos de aviso. La clave se guarda en `Notification.type`; `email` es si
 * por defecto también sale por correo (cada persona podrá apagarlo).
 */
export const NOTIFICATION_TYPES = {
  'acceso.solicitud.nueva': { module: 'Accesos', label: 'Solicitud de acceso nueva', email: true },
  'acceso.solicitud.aprobada': { module: 'Accesos', label: 'Acceso aprobado', email: true },
  'instituto.solicitud.nueva': {
    module: 'Instituto',
    label: 'Solicitud de inscripción nueva',
    email: true,
  },
  'instituto.solicitud.respondida': {
    module: 'Instituto',
    label: 'Respuesta a tu inscripción',
    email: true,
  },
  'instituto.contenido.nuevo': {
    module: 'Instituto',
    label: 'Material o tarea nueva',
    email: false,
  },
  'instituto.fecha.proxima': { module: 'Instituto', label: 'Fecha límite cerca', email: true },
  'instituto.nota.publicada': { module: 'Instituto', label: 'Nota publicada', email: true },
  'instituto.clase.proxima': { module: 'Instituto', label: 'Clase próxima', email: false },
  'muro.anuncio.nuevo': { module: 'Muro', label: 'Anuncio nuevo', email: false },
  'muro.comentario': { module: 'Muro', label: 'Comentario en tu publicación', email: false },
  'calendario.evento.proximo': { module: 'Calendario', label: 'Evento próximo', email: false },
  'acogida.asignacion': { module: 'Acogida', label: 'Registro asignado', email: true },
  'ruta.etapa': { module: 'Ruta', label: 'Avance en tu Ruta', email: true },
  'ruta.asignacion': { module: 'Ruta', label: 'Candidato asignado', email: true },
} as const satisfies Record<string, { module: string; label: string; email: boolean }>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
