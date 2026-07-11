import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePastor } from '../auth/decorators/require-pastor.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AddUserToGroupInput } from './dto/add-user-to-group.input';
import { CreateGroupInput } from './dto/create-group.input';
import { GroupMembershipModel } from './dto/group-membership.model';
import { GroupModel, RutaCohortOverviewModel } from './dto/group.model';
import { toGroupMembershipModel, toGroupModel } from './dto/to-group-model';
import { UpdateGroupInput } from './dto/update-group.input';
import { GroupsService } from './groups.service';

@Resolver(() => GroupModel)
export class GroupsResolver {
  constructor(private readonly groupsService: GroupsService) {}

  @Query(() => [GroupModel], { description: 'Grupos donde soy miembro activo o líder.' })
  async myGroups(@CurrentUser() me: AuthenticatedUser): Promise<GroupModel[]> {
    const groups = await this.groupsService.myGroups(me.sub);
    return groups.map(toGroupModel);
  }

  @Query(() => GroupModel)
  async group(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupModel> {
    return toGroupModel(await this.groupsService.findForViewer(me, id));
  }

  @RequirePastor()
  @Query(() => [GroupModel], { description: 'Todos los grupos (solo pastores).' })
  async groups(
    @Args('includeArchived', { defaultValue: false }) includeArchived: boolean,
  ): Promise<GroupModel[]> {
    const groups = await this.groupsService.list({ includeArchived });
    return groups.map(toGroupModel);
  }

  @Query(() => [RutaCohortOverviewModel], {
    description: 'Cohortes de la Ruta con su estado. Pastores: todas; líderes: las suyas.',
  })
  async rutaCohorts(@CurrentUser() me: AuthenticatedUser): Promise<RutaCohortOverviewModel[]> {
    const rows = await this.groupsService.rutaCohortOverviews(me);
    return rows.map((row) => ({ ...row, group: toGroupModel(row.group) }));
  }

  @ResolveField(() => [GroupMembershipModel])
  async members(@Parent() group: GroupModel): Promise<GroupMembershipModel[]> {
    const rows = await this.groupsService.listMembers(group.id);
    return rows.map(toGroupMembershipModel);
  }

  @RequirePastor()
  @Mutation(() => GroupModel)
  async createGroup(
    @Args('input') input: CreateGroupInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupModel> {
    return toGroupModel(await this.groupsService.create(me, input));
  }

  // Pastor o líder del grupo (validado en el service).
  @Mutation(() => GroupModel)
  async updateGroup(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateGroupInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupModel> {
    return toGroupModel(await this.groupsService.updateById(me, id, input));
  }

  // Líder del grupo o pastor (validado en el service).
  @Mutation(() => GroupModel, { description: 'Cierra el grupo una vez completado.' })
  async archiveGroup(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupModel> {
    return toGroupModel(await this.groupsService.archive(me, id));
  }

  @RequirePastor()
  @Mutation(() => GroupModel, { description: 'Reabre un grupo cerrado.' })
  async reopenGroup(@Args('id', { type: () => ID }) id: string): Promise<GroupModel> {
    return toGroupModel(await this.groupsService.reopen(id));
  }

  // Pastor o líder del grupo (validado en el service).
  @Mutation(() => GroupMembershipModel)
  async addUserToGroup(
    @Args('input') input: AddUserToGroupInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupMembershipModel> {
    return toGroupMembershipModel(await this.groupsService.addMember(me, input));
  }

  // Pastor o líder del grupo (validado en el service).
  @Mutation(() => GroupMembershipModel)
  async removeUserFromGroup(
    @Args('membershipId', { type: () => ID }) membershipId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<GroupMembershipModel> {
    return toGroupMembershipModel(await this.groupsService.removeMember(me, membershipId));
  }
}
