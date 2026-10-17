import { Test } from '@nestjs/testing';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MinistriesService } from './ministries.service';

describe('MinistriesService', () => {
  let service: MinistriesService;
  let users: UsersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [MinistriesService, UsersService, PrismaService, PermissionsService],
    }).compile();

    service = moduleRef.get(MinistriesService);
    users = moduleRef.get(UsersService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$executeRawUnsafe('DELETE FROM "Ministry"');
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$executeRawUnsafe('DELETE FROM "Ministry"');
  });

  it('creates a ministry with a unique slug', async () => {
    const m = await service.create({ slug: 'alabanza', name: 'Alabanza' });
    expect(m.slug).toBe('alabanza');
    await expect(service.create({ slug: 'alabanza', name: 'Duplicado' })).rejects.toThrow(/slug/i);
  });

  it('findBySlug excludes archived by default', async () => {
    const m = await service.create({ slug: 'jovenes', name: 'Jóvenes' });
    await service.archive(m.id);
    expect(await service.findBySlug('jovenes')).toBeNull();
    expect(await service.findBySlug('jovenes', { includeArchived: true })).not.toBeNull();
  });

  it('addMember creates an active membership, rejects duplicates', async () => {
    const m = await service.create({ slug: 'acogida', name: 'Acogida' });
    const u = await users.create({ email: 'a@b.com', firstName: 'A', lastName: 'B' });
    const mem = await service.addMember({ userId: u.id, ministryId: m.id, role: 'MEMBER' });
    expect(mem.leftAt).toBeNull();

    await expect(
      service.addMember({ userId: u.id, ministryId: m.id, role: 'MEMBER' }),
    ).rejects.toThrow(/active membership/i);
  });

  it('removeMember sets leftAt', async () => {
    const m = await service.create({ slug: 'acogida', name: 'Acogida' });
    const u = await users.create({ email: 'a@b.com', firstName: 'A', lastName: 'B' });
    const mem = await service.addMember({ userId: u.id, ministryId: m.id, role: 'MEMBER' });
    const removed = await service.removeMember(mem.id);
    expect(removed.leftAt).toBeInstanceOf(Date);
  });

  it('listMembers respects the includeLeft flag', async () => {
    const m = await service.create({ slug: 'acogida', name: 'Acogida' });
    const u1 = await users.create({ email: '1@x.com', firstName: 'A', lastName: 'B' });
    const u2 = await users.create({ email: '2@x.com', firstName: 'C', lastName: 'D' });
    const m1 = await service.addMember({ userId: u1.id, ministryId: m.id, role: 'MEMBER' });
    await service.addMember({ userId: u2.id, ministryId: m.id, role: 'LEADER' });
    await service.removeMember(m1.id);

    const active = await service.listMembers(m.id, {});
    expect(active).toHaveLength(1);

    const all = await service.listMembers(m.id, { includeLeft: true });
    expect(all).toHaveLength(2);
  });
});
