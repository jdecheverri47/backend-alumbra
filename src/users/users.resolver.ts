import { ForbiddenException } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireMinistryLeader } from '../auth/decorators/require-ministry-leader.decorator';
import { RequirePastor } from '../auth/decorators/require-pastor.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PaginationInput } from '../common/pagination/pagination.input';
import { CreateUserInput } from './dto/create-user.input';
import { MembershipInfoInput } from './dto/membership-info.input';
import { toUserModel } from './dto/to-user-model';
import { UpdateUserInput } from './dto/update-user.input';
import { UserConnection } from './dto/user-connection.type';
import { UserFilterInput } from './dto/user-filter.input';
import { UserModel } from './dto/user.model';
import { UsersService } from './users.service';

@Resolver(() => UserModel)
export class UsersResolver {
  constructor(private readonly usersService: UsersService) {}

  @Query(() => UserModel, { description: 'The currently authenticated user.' })
  async me(@CurrentUser() me: AuthenticatedUser): Promise<UserModel> {
    // Refetch to reflect changes made after the guard loaded the row.
    const user = await this.usersService.findByIdOrThrow(me.sub);
    return toUserModel(user);
  }

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

  // Pastors, or leaders of Acogida (the ministry that registers newcomers).
  @RequireMinistryLeader(() => ({ ministrySlug: 'acogida' }))
  @Mutation(() => UserModel)
  async createUser(@Args('input') input: CreateUserInput): Promise<UserModel> {
    const u = await this.usersService.create(input);
    return toUserModel(u);
  }

  @Mutation(() => UserModel)
  async updateUser(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<UserModel> {
    if (me.sub !== id && !me.isPastor) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You can only update your own profile.',
      });
    }
    const u = await this.usersService.updateById(id, input);
    return toUserModel(u);
  }

  @RequirePastor()
  @Mutation(() => UserModel)
  async softDeleteUser(@Args('id', { type: () => ID }) id: string): Promise<UserModel> {
    const u = await this.usersService.softDelete(id);
    return toUserModel(u);
  }

  @RequirePastor()
  @Mutation(() => UserModel)
  async setUserPastor(
    @Args('id', { type: () => ID }) id: string,
    @Args('isPastor') isPastor: boolean,
  ): Promise<UserModel> {
    const u = await this.usersService.setPastor(id, isPastor);
    return toUserModel(u);
  }

  @RequirePastor()
  @Mutation(() => UserModel, { description: 'Otorga o revoca el rol de líder a un miembro.' })
  async setUserLeader(
    @Args('id', { type: () => ID }) id: string,
    @Args('isLeader') isLeader: boolean,
  ): Promise<UserModel> {
    const u = await this.usersService.setLeader(id, isLeader);
    return toUserModel(u);
  }

  @RequirePastor()
  @Mutation(() => UserModel, { description: 'Registra fechas de membresía y bautismo.' })
  async setUserMembershipInfo(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: MembershipInfoInput,
  ): Promise<UserModel> {
    const u = await this.usersService.setMembershipInfo(id, input);
    return toUserModel(u);
  }

  @RequirePastor()
  @Mutation(() => UserModel)
  async setUserSignInAllowed(
    @Args('id', { type: () => ID }) id: string,
    @Args('allowed') allowed: boolean,
  ): Promise<UserModel> {
    const u = await this.usersService.setSignInAllowed(id, allowed);
    return toUserModel(u);
  }

  @Mutation(() => UserModel)
  async setUserPassword(
    @Args('id', { type: () => ID }) id: string,
    @Args('password') password: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<UserModel> {
    if (me.sub !== id && !me.isPastor) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You can only change your own password.',
      });
    }
    const u = await this.usersService.setPassword(id, password);
    return toUserModel(u);
  }
}
