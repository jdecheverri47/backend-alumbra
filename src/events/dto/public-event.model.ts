import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * La cara pública de un evento: lo que puede leer cualquiera desde el sitio
 * web, sin sesión.
 *
 * Es un tipo aparte y no `EventModel` a propósito. `EventModel` cuelga
 * `createdBy: UserModel` y `group: GroupModel`, y esos campos son navegables:
 * exponerlo sin sesión dejaría a un anónimo saltar del evento a los datos de
 * quien lo creó y a los miembros de un grupo. Aquí sólo hay escalares, así que
 * no hay a dónde saltar.
 *
 * Regla al tocar este archivo: nada de campos que apunten a otro `@ObjectType`.
 */
@ObjectType('PublicEvent')
export class PublicEventModel {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  location?: string | null;

  @Field(() => Date, {
    description: 'Los públicos siempre llevan fecha; los que no la tienen no se publican.',
  })
  startsAt!: Date;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;
}
