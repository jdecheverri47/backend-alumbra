import { registerEnumType } from '@nestjs/graphql';

/** Filtro del feed por visibilidad. Un asistente solo ve EVERYONE pida lo que pida. */
export enum FeedAudience {
  ALL = 'ALL',
  MEMBERS_ONLY = 'MEMBERS_ONLY',
  EVERYONE = 'EVERYONE',
}

registerEnumType(FeedAudience, {
  name: 'FeedAudience',
  valuesMap: {
    ALL: { description: 'Todo lo que puedo ver.' },
    MEMBERS_ONLY: { description: 'Solo las publicaciones internas (para miembros).' },
    EVERYONE: { description: 'Solo las publicaciones para toda la iglesia.' },
  },
});
