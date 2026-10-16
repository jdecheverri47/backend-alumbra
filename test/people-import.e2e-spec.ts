import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createUserWithPassword, login } from './setup/auth-helper';
import { requireLocalDb } from './setup/require-local-db';
import { wipeDb } from './setup/wipe-db';

const PASSWORD = 'super-secret-1';

const IMPORT = `mutation($rows: [ImportPersonInput!]!, $apply: Boolean!) {
  importPeople(rows: $rows, apply: $apply) {
    created updated unchanged errors applied
    rows { index action email baseRole ministries messages }
  }
}`;

describe('Importar personas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pastorToken: string;
  let miembroToken: string;

  const run = (token: string, rows: unknown[], apply: boolean) =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: IMPORT, variables: { rows, apply } })
      .expect(200);

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    await prisma.$connect();
    await wipeDb(prisma);

    await prisma.ministry.createMany({
      data: [
        { slug: 'alabanza', name: 'Alabanza' },
        { slug: 'alcance-mision', name: 'Alcance y Misión' },
      ],
    });
    await createUserWithPassword(prisma, {
      email: 'pastor@alumbra.test',
      password: PASSWORD,
      isPastor: true,
    });
    await createUserWithPassword(prisma, { email: 'miembro@alumbra.test', password: PASSWORD });
    // Ya existía como asistente y sin acceso.
    await prisma.user.create({
      data: {
        email: 'existente@alumbra.test',
        firstName: 'Eva',
        lastName: 'Ríos',
        baseRole: 'ASISTENTE',
      },
    });
    pastorToken = (await login(app, 'pastor@alumbra.test', PASSWORD)).accessToken;
    miembroToken = (await login(app, 'miembro@alumbra.test', PASSWORD)).accessToken;
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  const rows = [
    {
      firstName: 'Ana',
      lastName: 'Gómez',
      email: 'Ana@Correo.com ',
      phone: '3001234567',
      type: 'Miembro',
      membershipDate: '05/03/2019',
      ministries: 'Alabanza (coordinador), alcance',
    },
    { firstName: 'Luis', lastName: 'Pérez', email: 'luis@correo.com', type: 'asistente' },
    { firstName: 'Eva', lastName: 'Ríos', email: 'existente@alumbra.test', type: 'Miembro' },
    { firstName: 'Sin', lastName: 'Tipo', email: 'sintipo@correo.com', type: 'visitante' },
    { firstName: 'Ana', lastName: 'Repetida', email: 'ana@correo.com', type: 'Miembro' },
    {
      firstName: 'Asis',
      lastName: 'Ministro',
      email: 'asis@correo.com',
      type: 'Asistente',
      ministries: 'Alabanza',
    },
    {
      firstName: 'Mala',
      lastName: 'Fecha',
      email: 'f@correo.com',
      type: 'Miembro',
      baptismDate: '31/02/2020',
    },
  ];

  it('solo los pastores importan', async () => {
    const res = await run(miembroToken, rows, false);
    expect(res.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('la vista previa explica cada fila y no guarda nada', async () => {
    const res = await run(pastorToken, rows, false);
    const result = res.body.data.importPeople;
    expect(result).toMatchObject({ created: 2, updated: 1, errors: 4, applied: false });
    const byIndex = (i: number) => result.rows[i - 1];
    expect(byIndex(1)).toMatchObject({
      action: 'CREATE',
      email: 'ana@correo.com',
      baseRole: 'MIEMBRO',
      ministries: ['Alabanza (coordinador)', 'Alcance y Misión (ministro)'],
    });
    expect(byIndex(3).messages).toContain('Pasa de asistente a miembro.');
    expect(byIndex(4).messages[0]).toMatch(/Miembro" o "Asistente/);
    expect(byIndex(5).messages[0]).toMatch(/fila 1/);
    expect(byIndex(6).messages[0]).toMatch(/Solo los miembros/);
    expect(byIndex(7).messages[0]).toMatch(/bautismo/);
    expect(await prisma.user.count({ where: { email: 'ana@correo.com' } })).toBe(0);
  });

  it('al aplicar crea, completa y suma ministerios; repetirla no duplica', async () => {
    const res = await run(pastorToken, rows, true);
    expect(res.body.data.importPeople).toMatchObject({ created: 2, updated: 1, applied: true });

    const ana = await prisma.user.findUniqueOrThrow({
      where: { email: 'ana@correo.com' },
      include: { ministryMemberships: { include: { ministry: true } } },
    });
    expect(ana).toMatchObject({ baseRole: 'MIEMBRO', canSignIn: true, phone: '3001234567' });
    expect(ana.membershipDate?.toISOString()).toBe('2019-03-05T12:00:00.000Z');
    expect(ana.ministryMemberships.map((m) => [m.ministry.slug, m.role]).sort()).toEqual([
      ['alabanza', 'LEADER'],
      ['alcance-mision', 'MEMBER'],
    ]);
    const eva = await prisma.user.findUniqueOrThrow({ where: { email: 'existente@alumbra.test' } });
    expect(eva).toMatchObject({ baseRole: 'MIEMBRO', canSignIn: true });

    const again = await run(pastorToken, rows.slice(0, 3), true);
    expect(again.body.data.importPeople).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(await prisma.ministryMembership.count({ where: { userId: ana.id } })).toBe(2);
  });
});
