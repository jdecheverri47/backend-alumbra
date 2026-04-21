import { Test } from '@nestjs/testing';
import { HealthResolver } from './health.resolver';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthResolver', () => {
  let resolver: HealthResolver;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        HealthResolver,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    resolver = module.get(HealthResolver);
  });

  it('returns "pong" when the DB responds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    await expect(resolver.ping()).resolves.toBe('pong');
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('propagates the error when the DB is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    await expect(resolver.ping()).rejects.toThrow('connection refused');
  });
});
