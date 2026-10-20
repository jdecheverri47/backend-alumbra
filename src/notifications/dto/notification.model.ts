import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Notification, User } from '@prisma/client';
import { PageInfo } from '../../common/pagination/page-info.type';
import { encodeCursor } from '../../common/pagination/encode-cursor';

@ObjectType('NotificationActor')
export class NotificationActorModel {
  @Field(() => ID)
  id!: string;

  @Field()
  fullName!: string;

  @Field(() => String, { nullable: true })
  photoUrl?: string | null;
}

@ObjectType('Notification')
export class NotificationModel {
  @Field(() => ID)
  id!: string;

  @Field({ description: 'Clave del catálogo, p. ej. "acceso.solicitud.nueva".' })
  type!: string;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  body?: string | null;

  @Field(() => String, { nullable: true, description: 'A dónde lleva al abrirla.' })
  href?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Id de lo que trata el aviso (p. ej. la solicitud), para actuar desde la campana.',
  })
  refId?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Si pedía una decisión y ya se tomó: APPROVED o REJECTED.',
  })
  resolution?: string | null;

  @Field(() => String, { nullable: true, description: 'Quién tomó la decisión.' })
  resolvedByName?: string | null;

  @Field(() => NotificationActorModel, { nullable: true })
  actor?: NotificationActorModel | null;

  @Field(() => Date, { nullable: true })
  readAt?: Date | null;

  @Field()
  createdAt!: Date;
}

@ObjectType('NotificationEdge')
export class NotificationEdge {
  @Field(() => NotificationModel)
  node!: NotificationModel;

  @Field()
  cursor!: string;
}

@ObjectType('NotificationConnection')
export class NotificationConnection {
  @Field(() => [NotificationEdge])
  edges!: NotificationEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;
}

export function toNotificationModel(n: Notification & { actor: User | null }): NotificationModel {
  const data = (n.data ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    refId: str(data.refId),
    resolution: str(data.resolution),
    resolvedByName: str(data.resolvedByName),
    actor: n.actor
      ? {
          id: n.actor.id,
          fullName: `${n.actor.firstName} ${n.actor.lastName}`,
          photoUrl: n.actor.photoUrl,
        }
      : null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

export function toNotificationEdge(n: Notification & { actor: User | null }): NotificationEdge {
  return { node: toNotificationModel(n), cursor: encodeCursor(n.id) };
}
