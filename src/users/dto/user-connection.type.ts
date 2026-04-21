import { Field, ObjectType } from '@nestjs/graphql';
import { PageInfo } from '../../common/pagination/page-info.type';
import { UserModel } from './user.model';

@ObjectType('UserEdge')
export class UserEdge {
  @Field(() => UserModel)
  node!: UserModel;

  @Field()
  cursor!: string;
}

@ObjectType('UserConnection')
export class UserConnection {
  @Field(() => [UserEdge])
  edges!: UserEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;
}
