import { Event } from '@prisma/client';
import { PublicEventModel } from './public-event.model';

/**
 * Un evento publicable. `listPublic` filtra por rango de fechas, así que los
 * que no tienen fecha quedan fuera solos; el tipo lo deja explícito para no
 * tener que asertar en el mapper.
 */
export type PublicEventRow = Event & { startsAt: Date };

export function toPublicEventModel(event: PublicEventRow): PublicEventModel {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
  };
}
