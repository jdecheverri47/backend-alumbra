import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { NewcomerStatus } from './dto/newcomer-enums';
import { AddFollowUpInput, NewcomerFilterInput, NewcomerInput } from './dto/newcomer.inputs';
import { NewcomerFollowUpModel, NewcomerModel } from './dto/newcomer.model';
import { NewcomersService } from './newcomers.service';

/** El módulo de Acogida: personas nuevas y su seguimiento. */
@Resolver(() => NewcomerModel)
export class NewcomersResolver {
  constructor(private readonly service: NewcomersService) {}

  @Query(() => [NewcomerModel], { description: 'Personas nuevas, lo más reciente primero.' })
  async newcomers(
    @CurrentUser() me: AuthenticatedUser,
    @Args('filter', { nullable: true }) filter?: NewcomerFilterInput,
  ): Promise<NewcomerModel[]> {
    return this.service.list(me, filter ?? {});
  }

  @Query(() => NewcomerModel)
  async newcomer(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<NewcomerModel> {
    return this.service.get(me, id);
  }

  @ResolveField(() => [NewcomerFollowUpModel])
  async followUps(
    @Parent() newcomer: NewcomerModel,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<NewcomerFollowUpModel[]> {
    return this.service.followUps(me, newcomer.id);
  }

  @Mutation(() => NewcomerModel)
  async registerNewcomer(
    @CurrentUser() me: AuthenticatedUser,
    @Args('input') input: NewcomerInput,
  ): Promise<NewcomerModel> {
    return this.service.register(me, input);
  }

  @Mutation(() => NewcomerModel)
  async updateNewcomer(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: NewcomerInput,
  ): Promise<NewcomerModel> {
    return this.service.update(me, id, input);
  }

  @Mutation(() => NewcomerModel)
  async setNewcomerStatus(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('status', { type: () => NewcomerStatus }) status: NewcomerStatus,
  ): Promise<NewcomerModel> {
    return this.service.setStatus(me, id, status);
  }

  @Mutation(() => NewcomerModel, {
    description: 'Asigna (o quita, con userId nulo) el responsable del seguimiento.',
  })
  async assignNewcomer(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('userId', { type: () => ID, nullable: true }) userId: string | null,
  ): Promise<NewcomerModel> {
    return this.service.assign(me, id, userId ?? null);
  }

  @Mutation(() => NewcomerFollowUpModel)
  async addNewcomerFollowUp(
    @CurrentUser() me: AuthenticatedUser,
    @Args('input') input: AddFollowUpInput,
  ): Promise<NewcomerFollowUpModel> {
    return this.service.addFollowUp(me, input);
  }

  @Mutation(() => NewcomerModel)
  async deleteNewcomer(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<NewcomerModel> {
    return this.service.remove(me, id);
  }
}
