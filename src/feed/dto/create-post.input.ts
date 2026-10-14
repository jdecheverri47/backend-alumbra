import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { PostType } from './post-type.enum';

@InputType()
export class CreatePollInput {
  @Field(() => [String], { description: 'Entre 2 y 4 opciones.' })
  options!: string[];

  @Field(() => Int, {
    nullable: true,
    description: 'Horas hasta que cierra; sin valor, no cierra.',
  })
  durationHours?: number;
}

@InputType()
export class CreatePostInput {
  @Field(() => PostType, { defaultValue: 'POST' })
  type!: PostType;

  @Field()
  body!: string;

  @Field(() => [String], { defaultValue: [], description: 'URLs devueltas por POST /uploads.' })
  imageUrls!: string[];

  @Field(() => ID, { nullable: true, description: 'Evento a difundir con este post.' })
  eventId?: string;

  @Field({
    defaultValue: false,
    description: 'Interno: solo lo ven miembros y pastores. Por defecto lo ve toda la iglesia.',
  })
  membersOnly!: boolean;

  @Field(() => CreatePollInput, {
    nullable: true,
    description: 'Convierte el post en encuesta; el cuerpo es la pregunta.',
  })
  poll?: CreatePollInput;
}
