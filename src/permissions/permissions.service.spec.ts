import { Test } from '@nestjs/testing';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { wipeDb } from '../../test/setup/wipe-db';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from './permissions.service';

describe('PermissionsService.usersWith', () => {
  let service: PermissionsService;
  let prisma: PrismaService;

  const user = (email: string, data: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: { email, firstName: 'X', lastName: 'Y', canSignIn: true, ...data },
    });

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [PermissionsService, PrismaService],
    }).compile();
    service = moduleRef.get(PermissionsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(() => wipeDb(prisma));

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
  });

  it('incluye pastores y cargos con el permiso; deja fuera al resto', async () => {
    const pastor = await user('pastor@alumbra.test', { isPastor: true });
    const acogida = await prisma.ministry.create({ data: { slug: 'acogida', name: 'Acogida' } });
    const coordinador = await user('coord@alumbra.test');
    await prisma.ministryMembership.create({
      data: { userId: coordinador.id, ministryId: acogida.id, role: 'LEADER' },
    });
    const ministro = await user('ministro@alumbra.test');
    await prisma.ministryMembership.create({
      data: { userId: ministro.id, ministryId: acogida.id, role: 'MEMBER' },
    });
    await user('miembro@alumbra.test', { baseRole: 'MIEMBRO' });
    await user('sinacceso@alumbra.test', { isPastor: true, canSignIn: false });

    const ids = await service.usersWith('accesos.aprobar');

    expect(ids.sort()).toEqual([pastor.id, coordinador.id].sort());
  });
});
