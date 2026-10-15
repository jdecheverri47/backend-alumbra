import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Ministry } from '@prisma/client';
import { RequireMinistryLeader } from '../auth/decorators/require-ministry-leader.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePastor } from '../auth/decorators/require-pastor.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { UsersService } from '../users/users.service';
import { AddUserToMinistryInput } from './dto/add-user-to-ministry.input';
import { CreateMinistryInput } from './dto/create-ministry.input';
import { MinistryMembershipModel } from './dto/ministry-membership.model';
import { MinistryRole } from './dto/ministry-role.enum';
import { MinistryModel } from './dto/ministry.model';
import { toMembershipModel } from './dto/to-membership-model';
import { UpdateMinistryInput } from './dto/update-ministry.input';
import { MinistriesService } from './ministries.service';

@Resolver(() => MinistryModel)
export class MinistriesResolver {
  constructor(
    private readonly ministriesService: MinistriesService,
    private readonly usersService: UsersService,
  ) {}

  @Query(() => MinistryModel, { nullable: true })
  async ministry(@Args('slug') slug: string): Promise<MinistryModel | null> {
    return this.ministriesService.findBySlug(slug);
  }

  @Query(() => [MinistryModel])
  async ministries(
    @Args('includeArchived', { defaultValue: false }) includeArchived: boolean,
  ): Promise<MinistryModel[]> {
    return this.ministriesService.list({ includeArchived });
  }

  @Query(() => [MinistryMembershipModel], {
    description: 'Los ministerios en los que sirve quien consulta, con su rol.',
  })
  async myMinistries(@CurrentUser() me: AuthenticatedUser): Promise<MinistryMembershipModel[]> {
    const rows = await this.ministriesService.membershipsOf(me.sub);
    return rows.map((m) => toMembershipModel(m, m.user, m.ministry));
  }

  @ResolveField(() => MinistryRole, {
    nullable: true,
    description: 'El rol de quien consulta en este ministerio; null si no sirve en él.',
  })
  async myRole(
    @Parent() ministry: MinistryModel,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MinistryRole | null> {
    return this.ministriesService.roleOf(me.sub, ministry.id);
  }

  @ResolveField(() => [MinistryMembershipModel], {
    description: 'El equipo. Lo ven pastores y quienes sirven en el ministerio.',
  })
  async members(
    @Parent() ministry: MinistryModel,
    @CurrentUser() me: AuthenticatedUser,
    @Args('role', { type: () => MinistryRole, nullable: true }) role?: MinistryRole,
    @Args('includeLeft', { defaultValue: false }) includeLeft?: boolean,
  ): Promise<MinistryMembershipModel[]> {
    await this.ministriesService.assertCanView(me, ministry.id);
    const rows = await this.ministriesService.listMembers(ministry.id, { role, includeLeft });
    return rows.map((m) => toMembershipModel(m, m.user, ministry as unknown as Ministry));
  }

  @RequirePastor()
  @Mutation(() => MinistryModel)
  async createMinistry(@Args('input') input: CreateMinistryInput): Promise<MinistryModel> {
    return this.ministriesService.create(input);
  }

  @RequirePastor()
  @Mutation(() => MinistryModel)
  async updateMinistry(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateMinistryInput,
  ): Promise<MinistryModel> {
    return this.ministriesService.updateById(id, input);
  }

  @RequirePastor()
  @Mutation(() => MinistryModel)
  async archiveMinistry(@Args('id', { type: () => ID }) id: string): Promise<MinistryModel> {
    return this.ministriesService.archive(id);
  }

  @RequireMinistryLeader((args) => ({
    ministryId: (args.input as AddUserToMinistryInput).ministryId,
  }))
  @Mutation(() => MinistryMembershipModel)
  async addUserToMinistry(
    @Args('input') input: AddUserToMinistryInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MinistryMembershipModel> {
    const m = await this.ministriesService.assignMember(me, input);
    const [user, ministry] = await Promise.all([
      this.usersService.findByIdOrThrow(m.userId),
      this.ministriesService.findByIdOrThrow(m.ministryId),
    ]);
    return toMembershipModel(m, user, ministry);
  }

  @RequireMinistryLeader((args) => ({ membershipId: args.membershipId as string }))
  @Mutation(() => MinistryMembershipModel)
  async removeUserFromMinistry(
    @Args('membershipId', { type: () => ID }) membershipId: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<MinistryMembershipModel> {
    const m = await this.ministriesService.unassignMember(me, membershipId);
    const [user, ministry] = await Promise.all([
      this.usersService.findByIdOrThrow(m.userId),
      this.ministriesService.findByIdOrThrow(m.ministryId),
    ]);
    return toMembershipModel(m, user, ministry);
  }

  @RequirePastor()
  @Mutation(() => MinistryMembershipModel, {
    description: 'Cambia el rol dentro del ministerio: coordinador (LEADER) o ministro (MEMBER).',
  })
  async setMinistryRole(
    @Args('membershipId', { type: () => ID }) membershipId: string,
    @Args('role', { type: () => MinistryRole }) role: MinistryRole,
  ): Promise<MinistryMembershipModel> {
    const m = await this.ministriesService.setRole(membershipId, role);
    const [user, ministry] = await Promise.all([
      this.usersService.findByIdOrThrow(m.userId),
      this.ministriesService.findByIdOrThrow(m.ministryId),
    ]);
    return toMembershipModel(m, user, ministry);
  }
}
