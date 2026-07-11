import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MinistryTargetExtractor,
  REQUIRE_MINISTRY_LEADER_KEY,
} from '../decorators/require-ministry-leader.decorator';
import { requestFromContext } from './request-from-context';

@Injectable()
export class MinistryLeaderGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const extract = this.reflector.getAllAndOverride<MinistryTargetExtractor | undefined>(
      REQUIRE_MINISTRY_LEADER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!extract) return true;

    const request = requestFromContext(context);
    const me = request.user;
    if (!me) {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'Not authenticated.' });
    }
    if (me.isPastor) return true;

    const args = GqlExecutionContext.create(context).getArgs<Record<string, unknown>>();
    const ministryId = await this.resolveMinistryId(extract(args));

    const leadership = await this.prisma.ministryMembership.findFirst({
      where: { userId: me.sub, ministryId, role: 'LEADER', leftAt: null },
    });
    if (!leadership) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Requires pastor or leadership of the target ministry.',
      });
    }
    return true;
  }

  private async resolveMinistryId(ref: {
    ministryId?: string;
    membershipId?: string;
    ministrySlug?: string;
  }): Promise<string> {
    if (ref.ministryId) return ref.ministryId;

    if (ref.membershipId) {
      const membership = await this.prisma.ministryMembership.findUnique({
        where: { id: ref.membershipId },
      });
      if (!membership) {
        throw new NotFoundException(`Membership ${ref.membershipId} not found.`);
      }
      return membership.ministryId;
    }

    if (ref.ministrySlug) {
      const ministry = await this.prisma.ministry.findUnique({
        where: { slug: ref.ministrySlug },
      });
      if (!ministry) {
        throw new NotFoundException(`Ministry with slug "${ref.ministrySlug}" not found.`);
      }
      return ministry.id;
    }

    throw new ForbiddenException({
      error: 'FORBIDDEN',
      message: 'Could not determine target ministry.',
    });
  }
}
