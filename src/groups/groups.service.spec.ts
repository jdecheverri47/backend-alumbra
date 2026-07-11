import { Test } from '@nestjs/testing';
import { PrismaClient, User } from '@prisma/client';
import { wipeDb } from '../../test/setup/wipe-db';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsService } from './groups.service';

const asAuth = (u: User): AuthenticatedUser => ({
  sub: u.id,
  email: u.email,
  isPastor: u.isPastor,
  baseRole: u.baseRole,
  user: u,
});

describe('GroupsService', () => {
  let service: GroupsService;
  let prisma: PrismaService;
  let pastor: User;
  let miembro: User;
  let asistente: User;

  const seedUsers = async () => {
    pastor = await prisma.user.create({
      data: {
        email: 'pastor@x.com',
        firstName: 'P',
        lastName: 'Uno',
        isPastor: true,
        baseRole: 'MIEMBRO',
        canSignIn: true,
      },
    });
    miembro = await prisma.user.create({
      data: { email: 'miembro@x.com', firstName: 'M', lastName: 'Dos', baseRole: 'MIEMBRO' },
    });
    asistente = await prisma.user.create({
      data: { email: 'asistente@x.com', firstName: 'A', lastName: 'Tres', baseRole: 'ASISTENTE' },
    });
  };

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [GroupsService, PrismaService],
    }).compile();
    service = moduleRef.get(GroupsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await wipeDb(prisma as unknown as PrismaClient);
    await seedUsers();
  });

  afterAll(async () => {
    await wipeDb(prisma as unknown as PrismaClient);
    await prisma.$disconnect();
  });

  it('creates a MADUREZ group with the caller as default leader', async () => {
    const group = await service.create(asAuth(pastor), {
      type: 'MADUREZ',
      name: 'Madurez 1',
      meetingDay: 4,
      meetingTime: '19:00',
    });
    expect(group.leader.id).toBe(pastor.id);
    expect(group.type).toBe('MADUREZ');
  });

  it('rejects a MADUREZ group whose leader is neither pastor nor líder asignado', async () => {
    await expect(
      service.create(asAuth(pastor), { type: 'MADUREZ', name: 'Madurez X', leaderId: miembro.id }),
    ).rejects.toThrow(/pastor|líder/i);

    // Con el rol de líder otorgado sí puede dirigirlo.
    await prisma.user.update({ where: { id: miembro.id }, data: { isLeader: true } });
    const group = await service.create(asAuth(pastor), {
      type: 'MADUREZ',
      name: 'Madurez X',
      leaderId: miembro.id,
    });
    expect(group.leader.id).toBe(miembro.id);
  });

  it('allows a CONEXION group led by a non-pastor', async () => {
    const group = await service.create(asAuth(pastor), {
      type: 'CONEXION',
      name: 'Conexión 1',
      leaderId: miembro.id,
    });
    expect(group.leader.id).toBe(miembro.id);
  });

  it('leader adds people; only ASISTENTE can join CONEXION groups', async () => {
    const conexion = await service.create(asAuth(pastor), {
      type: 'CONEXION',
      name: 'Conexión 1',
      leaderId: miembro.id,
    });

    const membership = await service.addMember(asAuth(miembro), {
      userId: asistente.id,
      groupId: conexion.id,
    });
    expect(membership.user.id).toBe(asistente.id);

    await expect(
      service.addMember(asAuth(miembro), { userId: pastor.id, groupId: conexion.id }),
    ).rejects.toThrow(/asistentes/i);
  });

  it('MADUREZ accepts both miembros and asistentes', async () => {
    const madurez = await service.create(asAuth(pastor), { type: 'MADUREZ', name: 'Madurez 1' });
    await service.addMember(asAuth(pastor), { userId: miembro.id, groupId: madurez.id });
    await service.addMember(asAuth(pastor), { userId: asistente.id, groupId: madurez.id });
    const members = await service.listMembers(madurez.id);
    expect(members).toHaveLength(2);
  });

  it('rejects duplicate active memberships and non-leader adders', async () => {
    const madurez = await service.create(asAuth(pastor), { type: 'MADUREZ', name: 'Madurez 1' });
    await service.addMember(asAuth(pastor), { userId: miembro.id, groupId: madurez.id });

    await expect(
      service.addMember(asAuth(pastor), { userId: miembro.id, groupId: madurez.id }),
    ).rejects.toThrow(/ya pertenece/i);
    await expect(
      service.addMember(asAuth(miembro), { userId: asistente.id, groupId: madurez.id }),
    ).rejects.toThrow(/líder|pastor/i);
  });

  it('removeMember marks leftAt and myGroups reflects membership and leadership', async () => {
    const madurez = await service.create(asAuth(pastor), { type: 'MADUREZ', name: 'Madurez 1' });
    const membership = await service.addMember(asAuth(pastor), {
      userId: miembro.id,
      groupId: madurez.id,
    });

    expect((await service.myGroups(miembro.id)).map((g) => g.id)).toEqual([madurez.id]);
    expect((await service.myGroups(pastor.id)).map((g) => g.id)).toEqual([madurez.id]);

    const removed = await service.removeMember(asAuth(pastor), membership.id);
    expect(removed.leftAt).not.toBeNull();
    expect(await service.myGroups(miembro.id)).toHaveLength(0);
  });

  it('findForViewer denies outsiders and allows members, leader and pastors', async () => {
    const madurez = await service.create(asAuth(pastor), { type: 'MADUREZ', name: 'Madurez 1' });
    await service.addMember(asAuth(pastor), { userId: miembro.id, groupId: madurez.id });

    await expect(service.findForViewer(asAuth(miembro), madurez.id)).resolves.toBeTruthy();
    await expect(service.findForViewer(asAuth(pastor), madurez.id)).resolves.toBeTruthy();
    await expect(service.findForViewer(asAuth(asistente), madurez.id)).rejects.toThrow(
      /no perteneces/i,
    );
  });
});
