import { Test } from '@nestjs/testing';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, PrismaService],
    }).compile();

    service = moduleRef.get(UsersService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
  });

  it('creates a user with base role ASISTENTE and normalized email', async () => {
    const u = await service.create({
      email: 'JANE@EXAMPLE.COM',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    expect(u.email).toBe('jane@example.com');
    expect(u.baseRole).toBe('ASISTENTE');
    expect(u.isPastor).toBe(false);
  });

  it('rejects duplicate emails (case-insensitive)', async () => {
    await service.create({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe' });
    await expect(
      service.create({ email: 'JANE@example.com', firstName: 'J', lastName: 'D' }),
    ).rejects.toThrow(/email/i);
  });

  it('updateById applies changes', async () => {
    const u = await service.create({ email: 'a@b.com', firstName: 'A', lastName: 'B' });
    const updated = await service.updateById(u.id, { firstName: 'Ana' });
    expect(updated.firstName).toBe('Ana');
  });

  it('softDelete marks deletedAt and the user is not findable afterwards', async () => {
    const u = await service.create({ email: 'x@y.com', firstName: 'X', lastName: 'Y' });
    await service.softDelete(u.id);
    await expect(service.findById(u.id)).resolves.toBeNull();
  });

  it('setPastor toggles isPastor', async () => {
    const u = await service.create({ email: 'p@p.com', firstName: 'P', lastName: 'P' });
    const updated = await service.setPastor(u.id, true);
    expect(updated.isPastor).toBe(true);
  });

  it('list returns paginated users ordered by createdAt desc, then id desc', async () => {
    for (let i = 0; i < 5; i++) {
      await service.create({ email: `u${i}@x.com`, firstName: `U${i}`, lastName: 'X' });
    }
    const page1 = await service.list({}, { first: 2 });
    expect(page1.edges).toHaveLength(2);
    expect(page1.pageInfo.hasNextPage).toBe(true);

    const page2 = await service.list({}, { first: 2, after: page1.pageInfo.endCursor! });
    expect(page2.edges).toHaveLength(2);
    const idsPage1 = page1.edges.map((e) => e.node.id);
    const idsPage2 = page2.edges.map((e) => e.node.id);
    expect(idsPage1).not.toContain(idsPage2[0]);
  });

  it('list filters by search (email/name)', async () => {
    await service.create({ email: 'ana@x.com', firstName: 'Ana', lastName: 'Luz' });
    await service.create({ email: 'bob@x.com', firstName: 'Bob', lastName: 'Stone' });
    const result = await service.list({ search: 'ana' }, { first: 10 });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].node.email).toBe('ana@x.com');
  });
  it('setLeader: solo miembros (o pastores) reciben el rol; se puede revocar', async () => {
    const asistente = await service.create({ email: 'a@x.com', firstName: 'A', lastName: 'S' });
    await expect(service.setLeader(asistente.id, true)).rejects.toThrow(/miembros/i);

    const miembro = await service.create({ email: 'm@x.com', firstName: 'M', lastName: 'B' });
    await service.updateById(miembro.id, {});
    await prisma.user.update({ where: { id: miembro.id }, data: { baseRole: 'MIEMBRO' } });

    const granted = await service.setLeader(miembro.id, true);
    expect(granted.isLeader).toBe(true);
    const revoked = await service.setLeader(miembro.id, false);
    expect(revoked.isLeader).toBe(false);
  });
});
