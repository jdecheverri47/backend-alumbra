import { Field, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum ImportAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  UNCHANGED = 'UNCHANGED',
  ERROR = 'ERROR',
}
registerEnumType(ImportAction, { name: 'ImportAction' });

/** Una fila de la hoja, tal como viene (todo texto; el servidor valida). */
@InputType()
export class ImportPersonInput {
  @Field(() => String, { nullable: true })
  firstName?: string | null;

  @Field(() => String, { nullable: true })
  lastName?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true, description: '"Miembro" o "Asistente".' })
  type?: string | null;

  @Field(() => String, { nullable: true, description: 'dd/mm/aaaa o aaaa-mm-dd.' })
  membershipDate?: string | null;

  @Field(() => String, { nullable: true })
  baptismDate?: string | null;

  @Field(() => String, { nullable: true })
  birthDate?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Separados por comas; "(coordinador)" después del nombre lo nombra coordinador.',
  })
  ministries?: string | null;
}

@ObjectType()
export class ImportRowResult {
  @Field(() => Int, { description: 'Posición en la lista enviada, desde 1.' })
  index!: number;

  @Field(() => ImportAction)
  action!: ImportAction;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field()
  fullName!: string;

  @Field(() => String, { nullable: true })
  baseRole?: string | null;

  @Field(() => [String], { description: 'Ministerios que quedarían, con su rol.' })
  ministries!: string[];

  @Field(() => [String], { description: 'Errores, o qué se va a cambiar.' })
  messages!: string[];
}

@ObjectType()
export class ImportPeopleResult {
  @Field(() => [ImportRowResult])
  rows!: ImportRowResult[];

  @Field(() => Int)
  created!: number;

  @Field(() => Int)
  updated!: number;

  @Field(() => Int)
  unchanged!: number;

  @Field(() => Int)
  errors!: number;

  @Field({ description: 'false = solo vista previa; no se guardó nada.' })
  applied!: boolean;
}
