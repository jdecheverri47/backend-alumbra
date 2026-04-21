import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
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
      include: { ministry: true },
    });

    return memberships.map((m) => ({
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      user,
      ministry: m.ministry as MinistryMembershipModel['ministry'],
    }));
  }
}
