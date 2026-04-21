import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { PaginationInput } from '../common/pagination/pagination.input';
import { CreateUserInput } from './dto/create-user.input';
import { toUserModel } from './dto/to-user-model';
import { UpdateUserInput } from './dto/update-user.input';
import { UserConnection } from './dto/user-connection.type';
import { UserFilterInput } from './dto/user-filter.input';
import { UserModel } from './dto/user.model';
import { UsersService } from './users.service';

@Resolver(() => UserModel)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Query(() => UserModel, { nullable: true })
  async user(@Args('id', { type: () => ID }) id: string): Promise<UserModel | null> {
    const u = await this.usersService.findById(id);
    return u ? toUserModel(u) : null;
  }

  @Query(() => UserConnection)
  async users(
    @Args('filter', { nullable: true }) filter?: UserFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<UserConnection> {
    return this.usersService.list(filter ?? {}, pagination ?? { first: 20 });
  }

  @Mutation(() => UserModel)
  async createUser(@Args('input') input: CreateUserInput): Promise<UserModel> {
    const u = await this.usersService.create(input);
    return toUserModel(u);
  }

  @Mutation(() => UserModel)
  async updateUser(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserInput,
  ): Promise<UserModel> {
    const u = await this.usersService.updateById(id, input);
    return toUserModel(u);
  }

  @Mutation(() => UserModel)
  async softDeleteUser(@Args('id', { type: () => ID }) id: string): Promise<UserModel> {
    const u = await this.usersService.softDelete(id);
    return toUserModel(u);
  }

  // TODO(auth): restrict to isPastor=true once auth lands. Currently open.
  @Mutation(() => UserModel)
  async setUserPastor(
    @Args('id', { type: () => ID }) id: string,
    @Args('isPastor') isPastor: boolean,
  ): Promise<UserModel> {
    const u = await this.usersService.setPastor(id, isPastor);
    return toUserModel(u);
  }
}
