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

describe('Solicitudes de inscripción al Instituto (e2e)', () => {
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
  const errorMessage = (res: request.Response) => res.body.errors?.[0]?.message as string;

  const MINE = `{ myInstituteRequest { canRequest canRequestAgainAt request { id status reviewNote } } }`;
  const ACCESS = `{ myInstitute { canView canReviewRequests pendingRequests } }`;
  const REQUEST = `mutation($n: String) { requestInstituteEnrollment(note: $n) { id status note ministries groups } }`;
  const LIST = `{ instituteRequests { id note user { fullName } } }`;
  const APPROVE = `mutation($id: ID!) { approveInstituteRequest(id: $id) { status reviewedByName } }`;
  const REJECT = `mutation($id: ID!, $n: String) { rejectInstituteRequest(id: $id, reviewNote: $n) { status } }`;
  const NOTIFS = `{ notifications { edges { node { type title refId resolution } } } }`;

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  beforeEach(async () => {
    await wipeDb(prisma);
    // wipeDb borra los roles predefinidos; se siembran de nuevo como al arrancar.
    await app.get(PermissionsService).onModuleInit();
    for (const [key, isPastor] of [
      ['pastor', true],
      ['director', false],
      ['ana', false],
      ['beto', false],
    ] as const) {
      const email = `${key}@alumbra.test`;
      ids[key] = (
        await createUserWithPassword(prisma, {
          email,
          password: PASSWORD,
          isPastor,
          firstName: key[0].toUpperCase() + key.slice(1),
          lastName: 'Prueba',
          baseRole: 'ASISTENTE',
        })
      ).id;
      tokens[key] = (await login(app, email, PASSWORD)).accessToken;
    }
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'director-instituto' } });
    await prisma.roleBinding.create({
      data: { userId: ids.director, roleId: role.id, grantedById: ids.pastor },
    });
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  it('pedir → avisa a quienes aprueban → aprobar inscribe y le avisa', async () => {
    const before = await gql('ana', MINE);
    expect(before.body.data.myInstituteRequest).toEqual({
      canRequest: true,
      canRequestAgainAt: null,
      request: null,
    });

    const created = await gql('ana', REQUEST, { n: '  Quiero estudiar la Biblia  ' });
    const req = created.body.data.requestInstituteEnrollment;
    expect(req).toMatchObject({ status: 'PENDING', note: 'Quiero estudiar la Biblia' });

    // No puede pedir otra mientras esta espera.
    const twice = await gql('ana', REQUEST);
    expect(errorMessage(twice)).toBe('Ya tienes una solicitud en revisión.');

    // El director y el pastor la ven; Beto no tiene el permiso.
    expect((await gql('director', ACCESS)).body.data.myInstitute).toMatchObject({
      canReviewRequests: true,
      pendingRequests: 1,
    });
    expect((await gql('beto', LIST)).body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    const list = await gql('director', LIST);
    expect(list.body.data.instituteRequests).toHaveLength(1);

    for (const who of ['director', 'pastor']) {
      const n = (await gql(who, NOTIFS)).body.data.notifications.edges[0].node;
      expect(n).toMatchObject({
        type: 'instituto.solicitud.nueva',
        title: 'Ana Prueba quiere entrar al Instituto',
        refId: req.id,
        resolution: null,
      });
    }

    const approved = await gql('director', APPROVE, { id: req.id });
    expect(approved.body.data.approveInstituteRequest).toEqual({
      status: 'APPROVED',
      reviewedByName: 'Director Prueba',
    });

    expect((await gql('ana', ACCESS)).body.data.myInstitute.canView).toBe(true);
    const anaNotif = (await gql('ana', NOTIFS)).body.data.notifications.edges[0].node;
    expect(anaNotif).toMatchObject({
      type: 'instituto.solicitud.respondida',
      title: '¡Ya estás en el Instituto Bíblico!',
    });
    // El pastor ve que ya la resolvió el director.
    const pastorNotif = (await gql('pastor', NOTIFS)).body.data.notifications.edges[0].node;
    expect(pastorNotif.resolution).toBe('APPROVED');

    const again = await gql('pastor', APPROVE, { id: req.id });
    expect(errorMessage(again)).toBe('Esta solicitud ya fue revisada.');
  });

  it('rechazar con motivo: no puede volver a pedir hasta dentro de 30 días', async () => {
    const req = (await gql('beto', REQUEST)).body.data.requestInstituteEnrollment;

    await gql('pastor', REJECT, { id: req.id, n: 'Primero termina el curso de Evangelio' });

    const state = (await gql('beto', MINE)).body.data.myInstituteRequest;
    expect(state.canRequest).toBe(false);
    expect(state.request).toMatchObject({
      status: 'REJECTED',
      reviewNote: 'Primero termina el curso de Evangelio',
    });
    const days = (new Date(state.canRequestAgainAt).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    expect(errorMessage(await gql('beto', REQUEST))).toBe('Podrás volver a pedirla más adelante.');

    const notif = (await gql('beto', NOTIFS)).body.data.notifications.edges[0].node;
    expect(notif.title).toBe('Tu solicitud al Instituto no fue aprobada');

    // Pasado el plazo, sí.
    await prisma.instituteEnrollmentRequest.update({
      where: { id: req.id },
      data: { reviewedAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    expect((await gql('beto', MINE)).body.data.myInstituteRequest.canRequest).toBe(true);
  });

  it('cancelar la propia; inscribir a mano cierra la pendiente', async () => {
    await gql('ana', REQUEST);
    const cancel = await gql('ana', `mutation { cancelInstituteRequest }`);
    expect(cancel.body.data.cancelInstituteRequest).toBe(true);
    expect((await gql('ana', MINE)).body.data.myInstituteRequest.canRequest).toBe(true);
    const pastorNotif = (await gql('pastor', NOTIFS)).body.data.notifications.edges[0].node;
    expect(pastorNotif.resolution).toBe('CANCELLED');

    const req = (await gql('ana', REQUEST)).body.data.requestInstituteEnrollment;
    await gql(
      'pastor',
      `mutation($u: [ID!]!) { enrollInInstitute(input: { userIds: $u, role: STUDENT }) { id } }`,
      {
        u: [ids.ana],
      },
    );
    const row = await prisma.instituteEnrollmentRequest.findUniqueOrThrow({
      where: { id: req.id },
    });
    expect(row).toMatchObject({ status: 'APPROVED', reviewedById: ids.pastor });

    // Ya inscrita, no puede pedir.
    expect((await gql('ana', MINE)).body.data.myInstituteRequest.canRequest).toBe(false);
  });
});
