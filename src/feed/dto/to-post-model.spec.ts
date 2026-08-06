import { BaseRole, User } from '@prisma/client';
import { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { PostRow, toPostModel } from './to-post-model';

const user = (id: string): User =>
  ({
    id,
    email: `${id}@x.com`,
    firstName: 'N',
    lastName: 'N',
    baseRole: 'MIEMBRO',
    isPastor: false,
  }) as User;

const viewer = (baseRole: BaseRole, isPastor = false): AuthenticatedUser => ({
  sub: 'viewer',
  email: 'viewer@x.com',
  isPastor,
  baseRole,
  user: user('viewer'),
});

const postWithEvent = (membersOnly: boolean): PostRow =>
  ({
    id: 'post-1',
    type: 'POST',
    body: 'Nos vemos allá',
    author: user('autor'),
    images: [],
    pinnedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    event: {
      id: 'event-1',
      title: 'Reunión de miembros',
      description: null,
      location: null,
      startsAt: new Date('2026-08-30T15:00:00Z'),
      endsAt: null,
      membersOnly,
      groupId: null,
      createdById: 'autor',
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
      createdBy: user('autor'),
      group: null,
    },
  }) as unknown as PostRow;

describe('toPostModel', () => {
  it('oculta el evento de miembros a un asistente, pero deja el post', () => {
    const model = toPostModel(postWithEvent(true), viewer('ASISTENTE'));

    expect(model.event).toBeNull();
    expect(model.id).toBe('post-1');
    expect(model.body).toBe('Nos vemos allá');
  });

  it('se lo muestra a un miembro', () => {
    const model = toPostModel(postWithEvent(true), viewer('MIEMBRO'));

    expect(model.event?.title).toBe('Reunión de miembros');
  });

  it('se lo muestra a un pastor aunque no sea miembro', () => {
    const model = toPostModel(postWithEvent(true), viewer('ASISTENTE', true));

    expect(model.event?.title).toBe('Reunión de miembros');
  });

  it('un evento público lo ve cualquiera', () => {
    const model = toPostModel(postWithEvent(false), viewer('ASISTENTE'));

    expect(model.event?.title).toBe('Reunión de miembros');
  });
});
