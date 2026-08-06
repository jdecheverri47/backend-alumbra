import { Field, ID, ObjectType } from '@nestjs/graphql';
import { GroupModel } from '../../groups/dto/group.model';
import { UserModel } from '../../users/dto/user.model';

@ObjectType('Event')
export class EventModel {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  location?: string | null;

  @Field(() => String, { nullable: true, description: 'Afiche del evento.' })
  imageUrl?: string | null;

  @Field(() => Date, { nullable: true, description: 'null = fecha por definir.' })
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;

  @Field(() => GroupModel, { nullable: true, description: 'null = evento general.' })
  group?: GroupModel | null;

  @Field(() => Boolean, { description: 'true = solo para miembros; no se muestra a asistentes.' })
  membersOnly!: boolean;

  @Field(() => UserModel)
  createdBy!: UserModel;

  @Field(() => Date)
  createdAt!: Date;
}
