import { Event } from '@prisma/client';
import { PublicEventModel } from './public-event.model';

/**
 * Sirve tanto a los eventos con fecha como a los que aún no la tienen: el
 * `startsAt` viaja como venga y es la propia consulta la que decide cuáles
 * devuelve. Copia campo por campo a propósito — así, si alguien agrega una
 * relación al modelo de Prisma, no se cuela sola en la respuesta pública.
 */
export function toPublicEventModel(event: Event): PublicEventModel {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
  };
}
