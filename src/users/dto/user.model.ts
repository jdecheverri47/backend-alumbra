import { Field, ID, ObjectType } from '@nestjs/graphql';
import { BaseRole } from './base-role.enum';

@ObjectType('User')
export class UserModel {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  @Field({ description: 'Computed: firstName + " " + lastName.' })
  fullName!: string;

  @Field(() => BaseRole)
  baseRole!: BaseRole;

  @Field(() => Boolean)
  isPastor!: boolean;

  @Field(() => Boolean, {
    description: 'Rol de líder (dirige cohortes de la Ruta). Lo otorgan los pastores.',
  })
  isLeader!: boolean;

  @Field(() => Boolean, { description: 'Whether the user is allowed to log in.' })
  canSignIn!: boolean;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  photoUrl?: string | null;

  @Field(() => String, { nullable: true, description: 'Imagen de portada del perfil.' })
  coverUrl?: string | null;

  @Field(() => Date, { nullable: true })
  birthDate?: Date | null;

  @Field(() => Date, { nullable: true, description: 'Fecha de anexo a membresía.' })
  membershipDate?: Date | null;

  @Field(() => Date, { nullable: true, description: 'Fecha de bautismo.' })
  baptismDate?: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}
