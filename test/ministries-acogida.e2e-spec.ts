import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createUserWithPassword, login } from './setup/auth-helper';
import { requireLocalDb } from './setup/require-local-db';
import { wipeDb } from './setup/wipe-db';

const PASSWORD = 'super-secret-1';

describe('Ministerios + Acogida (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const gql = (who: string, query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${tokens[who]}`)
      .send({ query, variables })
      .expect(200);

  const errorCode = (res: request.Response) => res.body.errors?.[0]?.extensions?.code;

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

    const acogida = await prisma.ministry.create({ data: { slug: 'acogida', name: 'Acogida' } });
    const alabanza = await prisma.ministry.create({
      data: { slug: 'alabanza', name: 'Alabanza' },
    });
    ids.acogida = acogida.id;
    ids.alabanza = alabanza.id;

    const people: Array<[string, Parameters<typeof createUserWithPassword>[1]]> = [
      ['pastor', { email: 'pastor@alumbra.test', password: PASSWORD, isPastor: true }],
      ['coord', { email: 'coord@alumbra.test', password: PASSWORD }],
      ['ministro', { email: 'ministro@alumbra.test', password: PASSWORD }],
      ['otro', { email: 'otro@alumbra.test', password: PASSWORD }],
      ['asistente', { email: 'asis@alumbra.test', password: PASSWORD, baseRole: 'ASISTENTE' }],
    ];
    for (const [key, opts] of people) {
      ids[key] = (await createUserWithPassword(prisma, opts)).id;
      tokens[key] = (await login(app, opts.email, PASSWORD)).accessToken;
    }
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  const ADD = `mutation($u: ID!, $m: ID!, $r: MinistryRole!) {
    addUserToMinistry(input: { userId: $u, ministryId: $m, role: $r }) { id role }
  }`;

  it('pastor nombra coordinador; el coordinador suma ministros pero no coordinadores', async () => {
    const coord = await gql('pastor', ADD, { u: ids.coord, m: ids.acogida, r: 'LEADER' });
    expect(coord.body.data.addUserToMinistry.role).toBe('LEADER');

    const denied = await gql('coord', ADD, { u: ids.otro, m: ids.acogida, r: 'LEADER' });
    expect(errorCode(denied)).toBe('FORBIDDEN');

    const ministro = await gql('coord', ADD, { u: ids.ministro, m: ids.acogida, r: 'MEMBER' });
    ids.ministroMembership = ministro.body.data.addUserToMinistry.id;

    // Un asistente todavía no sirve.
    const asistente = await gql('pastor', ADD, { u: ids.asistente, m: ids.acogida, r: 'MEMBER' });
    expect(asistente.body.errors?.[0]?.message).toMatch(/solo los miembros/i);

    // El coordinador de Acogida no manda en Alabanza.
    const otherMinistry = await gql('coord', ADD, { u: ids.otro, m: ids.alabanza, r: 'MEMBER' });
    expect(errorCode(otherMinistry)).toBe('FORBIDDEN');
  });

  it('cada quien ve solo sus ministerios y su equipo', async () => {
    const mine = await gql('ministro', '{ myMinistries { role ministry { slug } } }');
    expect(mine.body.data.myMinistries).toEqual([
      { role: 'MEMBER', ministry: { slug: 'acogida' } },
    ]);

    const team = await gql(
      'ministro',
      '{ ministry(slug: "acogida") { myRole members { role user { email } } } }',
    );
    expect(team.body.data.ministry.myRole).toBe('MEMBER');
    expect(team.body.data.ministry.members).toHaveLength(2);

    const foreign = await gql('ministro', '{ ministry(slug: "alabanza") { members { id } } }');
    expect(errorCode(foreign)).toBe('FORBIDDEN');

    const pastor = await gql('pastor', '{ ministry(slug: "alabanza") { myRole members { id } } }');
    expect(pastor.body.data.ministry).toEqual({ myRole: null, members: [] });
  });

  it('solo pastores cambian el rol', async () => {
    const SET = `mutation($id: ID!) { setMinistryRole(membershipId: $id, role: LEADER) { role } }`;
    const denied = await gql('coord', SET, { id: ids.ministroMembership });
    expect(errorCode(denied)).toBe('FORBIDDEN');
    const ok = await gql('pastor', SET, { id: ids.ministroMembership });
    expect(ok.body.data.setMinistryRole.role).toBe('LEADER');
    // Lo deja como estaba para los siguientes tests.
    await gql(
      'pastor',
      `mutation($id: ID!) { setMinistryRole(membershipId: $id, role: MEMBER) { role } }`,
      { id: ids.ministroMembership },
    );
  });

  it('Acogida registra, anota contactos y asigna responsables', async () => {
    const outsider = await gql('otro', '{ newcomers { id } }');
    expect(errorCode(outsider)).toBe('FORBIDDEN');

    const registered = await gql(
      'ministro',
      `mutation($input: NewcomerInput!) {
        registerNewcomer(input: $input) {
          id fullName phone email status interests consent registeredBy { email }
        }
      }`,
      {
        input: {
          firstName: 'Ana',
          lastName: 'Gómez',
          phone: '300 123 4567',
          email: '',
          interests: ['GRUPO_CONEXION', 'BAUTISMO'],
          consent: true,
        },
      },
    );
    const ana = registered.body.data.registerNewcomer;
    expect(ana).toMatchObject({
      fullName: 'Ana Gómez',
      email: null,
      status: 'NUEVO',
      interests: ['GRUPO_CONEXION', 'BAUTISMO'],
      registeredBy: { email: 'ministro@alumbra.test' },
    });

    // Anotar un contacto la pasa de NUEVO a CONTACTADO.
    await gql(
      'ministro',
      `mutation($id: ID!) {
        addNewcomerFollowUp(input: { newcomerId: $id, kind: LLAMADA, note: "Le conté de los grupos" }) { id }
      }`,
      { id: ana.id },
    );
    const detail = await gql(
      'coord',
      `query($id: ID!) { newcomer(id: $id) { status followUpCount followUps { kind note author { email } } } }`,
      { id: ana.id },
    );
    expect(detail.body.data.newcomer).toMatchObject({
      status: 'CONTACTADO',
      followUpCount: 1,
      followUps: [{ kind: 'LLAMADA', author: { email: 'ministro@alumbra.test' } }],
    });

    const ASSIGN = `mutation($id: ID!, $u: ID) { assignNewcomer(id: $id, userId: $u) { assignedTo { email } } }`;
    expect(errorCode(await gql('ministro', ASSIGN, { id: ana.id, u: ids.ministro }))).toBe(
      'FORBIDDEN',
    );
    const outsiderAssignee = await gql('coord', ASSIGN, { id: ana.id, u: ids.otro });
    expect(outsiderAssignee.body.errors?.[0]?.message).toMatch(/equipo de Acogida/);
    const assigned = await gql('coord', ASSIGN, { id: ana.id, u: ids.ministro });
    expect(assigned.body.data.assignNewcomer.assignedTo.email).toBe('ministro@alumbra.test');

    const mine = await gql('ministro', '{ newcomers(filter: { assignedToMe: true }) { id } }');
    expect(mine.body.data.newcomers).toEqual([{ id: ana.id }]);
    const search = await gql('ministro', '{ newcomers(filter: { search: "4567" }) { id } }');
    expect(search.body.data.newcomers).toHaveLength(1);

    expect(
      errorCode(
        await gql('ministro', `mutation($id: ID!) { deleteNewcomer(id: $id) { id } }`, {
          id: ana.id,
        }),
      ),
    ).toBe('FORBIDDEN');
    await gql('coord', `mutation($id: ID!) { deleteNewcomer(id: $id) { id } }`, { id: ana.id });
    const after = await gql('pastor', '{ newcomers { id } }');
    expect(after.body.data.newcomers).toEqual([]);
  });

  it('el coordinador no puede sacar a otro coordinador', async () => {
    const coordMembership = await prisma.ministryMembership.findFirstOrThrow({
      where: { userId: ids.coord, leftAt: null },
    });
    const REMOVE = `mutation($id: ID!) { removeUserFromMinistry(membershipId: $id) { leftAt } }`;
    await prisma.ministryMembership.create({
      data: { userId: ids.otro, ministryId: ids.acogida, role: 'LEADER' },
    });
    const other = await prisma.ministryMembership.findFirstOrThrow({
      where: { userId: ids.otro, leftAt: null },
    });
    expect(errorCode(await gql('coord', REMOVE, { id: other.id }))).toBe('FORBIDDEN');
    const ok = await gql('coord', REMOVE, { id: ids.ministroMembership });
    expect(ok.body.data.removeUserFromMinistry.leftAt).not.toBeNull();
    expect(coordMembership.role).toBe('LEADER');
  });
});
