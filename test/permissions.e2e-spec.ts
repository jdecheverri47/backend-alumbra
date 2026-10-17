import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PermissionsService } from '../src/permissions/permissions.service';
import { createUserWithPassword, login } from './setup/auth-helper';
import { requireLocalDb } from './setup/require-local-db';
import { wipeDb } from './setup/wipe-db';

const PASSWORD = 'super-secret-1';

describe('Permisos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roles: Record<string, string> = {};

  const gql = (who: string, query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${tokens[who]}`)
      .send({ query, variables })
      .expect(200);
  const errorCode = (res: request.Response) => res.body.errors?.[0]?.extensions?.code;
  const errorMessage = (res: request.Response) => res.body.errors?.[0]?.message as string;

  const GRANT = `mutation($input: GrantRoleInput!) { grantRole(input: $input) { id scopeName role { name } } }`;
  const grant = (
    who: string,
    userId: string,
    roleId: string,
    scope?: { type: string; id: string },
  ) =>
    gql(who, GRANT, {
      input: { userId, roleId, scopeType: scope?.type ?? 'CHURCH', scopeId: scope?.id ?? null },
    });

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
    // El wipe borra los roles predefinidos: se vuelven a sembrar.
    await app.get(PermissionsService).onModuleInit();

    for (const [key, isPastor] of [
      ['pastor', true],
      ['secre', false],
      ['delegado', false],
      ['otro', false],
    ] as const) {
      const email = `${key}@alumbra.test`;
      ids[key] = (await createUserWithPassword(prisma, { email, password: PASSWORD, isPastor })).id;
      tokens[key] = (await login(app, email, PASSWORD)).accessToken;
    }
    ids.acogida = (await prisma.ministry.create({ data: { slug: 'acogida', name: 'Acogida' } })).id;
    ids.alabanza = (
      await prisma.ministry.create({ data: { slug: 'alabanza', name: 'Alabanza' } })
    ).id;

    const list = await gql('pastor', '{ roles { id key system } }');
    for (const r of list.body.data.roles) roles[r.key] = r.id;
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  it('solo quien administra permisos ve y da roles', async () => {
    expect(errorCode(await gql('secre', '{ roles { id } }'))).toBe('FORBIDDEN');
    expect(errorCode(await grant('secre', ids.secre, roles['comunicaciones']))).toBe('FORBIDDEN');
    expect(Object.keys(roles)).toEqual(
      expect.arrayContaining([
        'administrador-personas',
        'comunicaciones',
        'administrador-permisos',
      ]),
    );
  });

  it('un rol predefinido da sus permisos; sobre la cuenta de un pastor manda solo otro pastor', async () => {
    const CREATE = `mutation { createUser(input: { email: "nueva@alumbra.test", firstName: "Nueva", lastName: "Persona" }) { id } }`;
    expect(errorCode(await gql('secre', CREATE))).toBe('FORBIDDEN');

    await grant('pastor', ids.secre, roles['administrador-personas']);
    const created = await gql('secre', CREATE);
    expect(created.body.data.createUser.id).toBeTruthy();

    const PASSWORD_OF = `mutation($id: ID!) { setUserPassword(id: $id, password: "otra-clave-123") { id } }`;
    expect(errorMessage(await gql('secre', PASSWORD_OF, { id: ids.pastor }))).toMatch(
      /otro pastor/,
    );
    expect(
      errorCode(
        await gql('secre', `mutation($id: ID!) { setUserPastor(id: $id, isPastor: true) { id } }`, {
          id: ids.secre,
        }),
      ),
    ).toBe('FORBIDDEN');
    // Nadie se marca a sí mismo como líder aunque administre cuentas… salvo con el permiso.
    const leader = await gql(
      'otro',
      `mutation($id: ID!) { setUserLeader(id: $id, isLeader: true) { id } }`,
      { id: ids.otro },
    );
    expect(errorCode(leader)).toBe('FORBIDDEN');
  });

  it('roles personalizados: se crean, se dan y al quitarlos dejan de valer de inmediato', async () => {
    const created = await gql(
      'pastor',
      `mutation { createRole(input: { name: "Anuncios", permissions: ["muro.anunciar"] }) { id system } }`,
    );
    const roleId = created.body.data.createRole.id;
    expect(created.body.data.createRole.system).toBe(false);
    expect(
      errorMessage(
        await gql(
          'pastor',
          `mutation { createRole(input: { name: "Mal", permissions: ["no.existe"] }) { id } }`,
        ),
      ),
    ).toMatch(/no existen/);

    const ANNOUNCE = `mutation { createPost(input: { type: ANUNCIO, body: "Culto especial" }) { id } }`;
    expect(errorCode(await gql('otro', ANNOUNCE))).toBe('FORBIDDEN');
    const binding = await grant('pastor', ids.otro, roleId);
    expect((await gql('otro', ANNOUNCE)).body.data.createPost.id).toBeTruthy();

    await gql('pastor', `mutation($id: ID!) { revokeRoleBinding(id: $id) }`, {
      id: binding.body.data.grantRole.id,
    });
    expect(errorCode(await gql('otro', ANNOUNCE))).toBe('FORBIDDEN');

    // Los predefinidos no se editan ni se borran.
    expect(
      errorMessage(
        await gql('pastor', `mutation($id: ID!) { deleteRole(id: $id) }`, {
          id: roles['comunicaciones'],
        }),
      ),
    ).toMatch(/predefinidos/);
  });

  it('el alcance: un rol sobre un ministerio solo vale ahí, y los permisos de iglesia no se cuelan', async () => {
    await grant('pastor', ids.otro, roles['coordinador-ministerio'], {
      type: 'MINISTRY',
      id: ids.alabanza,
    });
    // La persona a sumar tiene que ser miembro.
    const ADD = `mutation($u: ID!, $m: ID!) { addUserToMinistry(input: { userId: $u, ministryId: $m, role: MEMBER }) { id } }`;
    expect(
      (await gql('otro', ADD, { u: ids.delegado, m: ids.alabanza })).body.data.addUserToMinistry.id,
    ).toBeTruthy();
    expect(errorCode(await gql('otro', ADD, { u: ids.delegado, m: ids.acogida }))).toBe(
      'FORBIDDEN',
    );
    // Nombrar coordinadores sigue siendo de quien administra ministerios.
    const LEAD = `mutation($u: ID!, $m: ID!) { addUserToMinistry(input: { userId: $u, ministryId: $m, role: LEADER }) { id } }`;
    expect(errorCode(await gql('otro', LEAD, { u: ids.secre, m: ids.alabanza }))).toBe('FORBIDDEN');

    const noScope = await grant('pastor', ids.otro, roles['administrador-personas'], {
      type: 'MINISTRY',
      id: ids.alabanza,
    });
    expect(errorMessage(noScope)).toMatch(/se puede dar sobre el ministerio Alabanza/);
  });

  it('se puede delegar la administración de permisos, y todo queda en el historial', async () => {
    await grant('pastor', ids.delegado, roles['administrador-permisos']);
    const delegated = await grant('delegado', ids.secre, roles['comunicaciones']);
    expect(delegated.body.data.grantRole.role.name).toBe('Comunicaciones');

    const mine = await gql('secre', '{ myPermissions { all grants { permission source via } } }');
    expect(mine.body.data.myPermissions.all).toBe(false);
    expect(mine.body.data.myPermissions.grants).toEqual(
      expect.arrayContaining([
        { permission: 'muro.anunciar', source: 'rol', via: 'Comunicaciones' },
      ]),
    );

    const log = await gql(
      'pastor',
      '{ permissionAudit(limit: 20) { action summary actor { email } } }',
    );
    expect(log.body.data.permissionAudit[0]).toMatchObject({
      action: 'GRANT',
      actor: { email: 'delegado@alumbra.test' },
    });
    expect(log.body.data.permissionAudit.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['ROLE_CREATE', 'REVOKE', 'GRANT']),
    );
  });
});
