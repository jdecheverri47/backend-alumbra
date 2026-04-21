import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { UsersService } from '../users/users.service';
import { AddUserToMinistryInput } from './dto/add-user-to-ministry.input';
import { CreateMinistryInput } from './dto/create-ministry.input';
import { MinistryMembershipModel } from './dto/ministry-membership.model';
import { MinistryRole } from './dto/ministry-role.enum';
import { MinistryModel } from './dto/ministry.model';
import { UpdateMinistryInput } from './dto/update-ministry.input';
import { MinistriesService } from './ministries.service';

@Resolver(() => MinistryModel)
export class MinistriesResolver {
  constructor(
    private readonly ministriesSvc: MinistriesService,
    private readonly usersSvc: UsersService,
  ) {}

  @Query(() => MinistryModel, { nullable: true })
  async ministry(@Args('slug') slug: string): Promise<MinistryModel | null> {
    return this.ministriesSvc.findBySlug(slug);
  }

  @Query(() => [MinistryModel])
  async ministries(
    @Args('includeArchived', { defaultValue: false }) includeArchived: boolean,
  ): Promise<MinistryModel[]> {
    return this.ministriesSvc.list({ includeArchived });
  }

  @ResolveField(() => [MinistryMembershipModel])
  async members(
    @Parent() ministry: MinistryModel,
    @Args('role', { type: () => MinistryRole, nullable: true }) role?: MinistryRole,
    @Args('includeLeft', { defaultValue: false }) includeLeft?: boolean,
  ): Promise<MinistryMembershipModel[]> {
    const rows = await this.ministriesSvc.listMembers(ministry.id, { role, includeLeft });
    return rows.map((m) => ({
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      user: toUserModel(m.user),
      ministry,
    }));
  }

  @Mutation(() => MinistryModel)
  async createMinistry(@Args('input') input: CreateMinistryInput): Promise<MinistryModel> {
    return this.ministriesSvc.create(input);
  }

  @Mutation(() => MinistryModel)
  async updateMinistry(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateMinistryInput,
  ): Promise<MinistryModel> {
    return this.ministriesSvc.updateById(id, input);
  }

  @Mutation(() => MinistryModel)
  async archiveMinistry(@Args('id', { type: () => ID }) id: string): Promise<MinistryModel> {
    return this.ministriesSvc.archive(id);
  }

  @Mutation(() => MinistryMembershipModel)
  async addUserToMinistry(
    @Args('input') input: AddUserToMinistryInput,
  ): Promise<MinistryMembershipModel> {
    const m = await this.ministriesSvc.addMember(input);
    const [user, ministry] = await Promise.all([
      this.usersSvc.findByIdOrThrow(m.userId),
      this.ministriesSvc.findByIdOrThrow(m.ministryId),
    ]);
    return {
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      user: toUserModel(user),
      ministry,
    };
  }

  @Mutation(() => MinistryMembershipModel)
  async removeUserFromMinistry(
    @Args('membershipId', { type: () => ID }) membershipId: string,
  ): Promise<MinistryMembershipModel> {
    const m = await this.ministriesSvc.removeMember(membershipId);
    const [user, ministry] = await Promise.all([
      this.usersSvc.findByIdOrThrow(m.userId),
      this.ministriesSvc.findByIdOrThrow(m.ministryId),
    ]);
    return {
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      user: toUserModel(user),
      ministry,
    };
  }
}

function toUserModel(u: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  baseRole: 'ASISTENTE' | 'MIEMBRO';
  isPastor: boolean;
  phone: string | null;
  photoUrl: string | null;
  birthDate: Date | null;
  createdAt: Date;
}) {
  return { ...u, fullName: `${u.firstName} ${u.lastName}` };
}
