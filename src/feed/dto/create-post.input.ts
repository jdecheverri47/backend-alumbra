import { Field, ID, InputType } from '@nestjs/graphql';
import { PostType } from './post-type.enum';

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
}
