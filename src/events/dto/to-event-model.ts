import { Event, Group, User } from '@prisma/client';
import { toGroupModel } from '../../groups/dto/to-group-model';
import { toUserModel } from '../../users/dto/to-user-model';
import { EventModel } from './event.model';

export type EventRow = Event & { createdBy: User; group: (Group & { leader: User }) | null };

export function toEventModel(event: EventRow): EventModel {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    imageUrl: event.imageUrl,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    group: event.group ? toGroupModel(event.group) : null,
    membersOnly: event.membersOnly,
    createdBy: toUserModel(event.createdBy),
    createdAt: event.createdAt,
  };
}
