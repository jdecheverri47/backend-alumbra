import { requireLocalDb } from '../../test/setup/require-local-db';
import { PrismaService } from './prisma.service';

describe('PrismaService soft-delete middleware for User', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    requireLocalDb();
    prisma = new PrismaService();
    await prisma.$connect();
    // Clean slate for the test
    await prisma.user.deleteMany({}).catch(() => {
      // deleteMany is intercepted; fall back to raw delete if the DB has leftovers
    });
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$disconnect();
  });

  it('delete on User sets deletedAt instead of removing the row', async () => {
    const user = await prisma.user.create({
      data: { email: 'soft@example.com', firstName: 'Soft', lastName: 'Del' },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const raw = await prisma.$queryRawUnsafe<Array<{ id: string; deletedAt: Date | null }>>(
      `SELECT id, "deletedAt" FROM "User" WHERE id = $1`,
      user.id,
    );
    expect(raw).toHaveLength(1);
    expect(raw[0].deletedAt).toBeInstanceOf(Date);
  });

  it('findMany excludes soft-deleted users by default', async () => {
    const a = await prisma.user.create({
      data: { email: 'alive@example.com', firstName: 'Alive', lastName: 'User' },
    });
    const b = await prisma.user.create({
      data: { email: 'dead@example.com', firstName: 'Dead', lastName: 'User' },
    });
    await prisma.user.delete({ where: { id: b.id } });

    const users = await prisma.user.findMany();
    const ids = users.map((u) => u.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });

  it('findMany with explicit deletedAt filter is respected', async () => {
    const users = await prisma.user.findMany({ where: { deletedAt: { not: null } } });
    expect(users.length).toBeGreaterThan(0);
  });
});
