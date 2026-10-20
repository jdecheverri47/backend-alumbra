import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('NotificationPreference')
export class NotificationPreferenceModel {
  @Field({ description: 'Clave del catálogo, p. ej. "instituto.nota.publicada".' })
  type!: string;

  @Field({ description: 'Módulo, para agrupar: Instituto, Muro, Acogida…' })
  module!: string;

  @Field()
  label!: string;

  @Field({ description: 'Si este tipo también le llega por correo.' })
  email!: boolean;

  @Field({ description: 'Lo que trae por defecto, si nunca lo cambió.' })
  emailByDefault!: boolean;
}
