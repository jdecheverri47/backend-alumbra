import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    this.installSoftDeleteMiddleware();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private installSoftDeleteMiddleware(): void {
    this.$use(async (params, next) => {
      if (params.model !== 'User') {
        return next(params);
      }

      if (params.action === 'delete') {
        params.action = 'update';
        params.args = {
          ...params.args,
          data: { deletedAt: new Date() },
        };
        return next(params);
      }

      if (params.action === 'deleteMany') {
        params.action = 'updateMany';
        params.args = {
          ...params.args,
          data: { deletedAt: new Date() },
        };
        return next(params);
      }

      if (params.action === 'findMany' || params.action === 'findFirst' || params.action === 'count') {
        params.args = params.args ?? {};
        const where = (params.args.where ?? {}) as Prisma.UserWhereInput;
        if (where.deletedAt === undefined) {
          params.args.where = { ...where, deletedAt: null };
        }
        return next(params);
      }

      if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
        // findUnique cannot accept deletedAt in `where`. Convert to findFirst.
        params.action = 'findFirst';
        const where = (params.args?.where ?? {}) as Prisma.UserWhereInput;
        params.args = { ...params.args, where: { ...where, deletedAt: null } };
        return next(params);
      }

      return next(params);
    });
  }
}
