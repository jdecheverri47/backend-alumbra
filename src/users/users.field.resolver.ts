import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { MinistryMembershipModel } from '../ministries/dto/ministry-membership.model';
import { MinistriesService } from '../ministries/ministries.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserModel } from './dto/user.model';

@Resolver(() => UserModel)
export class UsersFieldResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ministriesService: MinistriesService,
  ) {}

  @ResolveField(() => [MinistryMembershipModel])
  async ministries(@Parent() user: UserModel): Promise<MinistryMembershipModel[]> {
    const memberships = await this.prisma.ministryMembership.findMany({
      where: { userId: user.id, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });

    return Promise.all(
      memberships.map(async (m) => ({
        id: m.id,
        role: m.role,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
        user,
        ministry: (await this.ministriesService.findByIdOrThrow(m.ministryId)) as MinistryMembershipModel['ministry'],
      })),
    );
  }
}
