import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { toMembershipModel } from '../ministries/dto/to-membership-model';
import { MinistryMembershipModel } from '../ministries/dto/ministry-membership.model';
import { PrismaService } from '../prisma/prisma.service';
import { UserModel } from './dto/user.model';

@Resolver(() => UserModel)
export class UsersFieldResolver {
  constructor(private readonly prisma: PrismaService) {}

  @ResolveField(() => [MinistryMembershipModel])
  async ministries(@Parent() user: UserModel): Promise<MinistryMembershipModel[]> {
    const memberships = await this.prisma.ministryMembership.findMany({
      where: { userId: user.id, leftAt: null },
      orderBy: { joinedAt: 'desc' },
      include: { ministry: true, user: true },
    });

    return memberships.map((m) => toMembershipModel(m, m.user, m.ministry));
  }
}
