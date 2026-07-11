import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createUserWithPassword, login } from './setup/auth-helper';
import { requireLocalDb } from './setup/require-local-db';
import { wipeDb } from './setup/wipe-db';

const PASSWORD = 'super-secret-1';

const wipe = (prisma: PrismaClient) => wipeDb(prisma);

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

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
    await wipe(prisma);
  });

  afterAll(async () => {
    await wipe(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('POST /auth/login', () => {
    it('rejects unknown email and wrong password with the same generic error', async () => {
      await createUserWithPassword(prisma, { email: 'ana@alumbra.test', password: PASSWORD });

      const unknown = await request(server())
        .post('/auth/login')
        .send({ email: 'nadie@alumbra.test', password: PASSWORD })
        .expect(401);
      const wrongPassword = await request(server())
        .post('/auth/login')
        .send({ email: 'ana@alumbra.test', password: 'not-the-password' })
        .expect(401);

      expect(unknown.body.error).toBe('INVALID_CREDENTIALS');
      expect(wrongPassword.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('rejects users with canSignIn=false even with correct password', async () => {
      await createUserWithPassword(prisma, {
        email: 'asistente@alumbra.test',
        password: PASSWORD,
        baseRole: 'ASISTENTE',
        canSignIn: false,
      });

      const res = await request(server())
        .post('/auth/login')
        .send({ email: 'asistente@alumbra.test', password: PASSWORD })
        .expect(403);
      expect(res.body.error).toBe('ACCESS_NOT_GRANTED');
    });

    it('logs in with valid credentials, returns access token + refresh cookie, and me works', async () => {
      const user = await createUserWithPassword(prisma, {
        email: 'ana@alumbra.test',
        password: PASSWORD,
      });

      const { accessToken, cookies, body } = await login(app, 'ana@alumbra.test', PASSWORD);
      expect(accessToken).toBeTruthy();
      expect((body.user as { id: string }).id).toBe(user.id);
      expect(cookies.some((c) => c.startsWith('alumbra_rt=') && c.includes('HttpOnly'))).toBe(true);

      const me = await request(server())
        .post('/graphql')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ query: '{ me { id email } }' })
        .expect(200);
      expect(me.body.data.me.email).toBe('ana@alumbra.test');
    });
  });

  describe('GraphQL authentication', () => {
    it('rejects GraphQL queries without a token', async () => {
      const res = await request(server()).post('/graphql').send({ query: '{ me { id } }' });
      expect(res.body.data ?? null).toBeNull();
      expect(res.body.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    });

    it('keeps apiVersion public', async () => {
      const res = await request(server())
        .post('/graphql')
        .send({ query: '{ apiVersion }' })
        .expect(200);
      expect(res.body.data.apiVersion).toBeTruthy();
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token: the previous one stops working, the new one keeps working', async () => {
      await createUserWithPassword(prisma, { email: 'ana@alumbra.test', password: PASSWORD });
      const first = await login(app, 'ana@alumbra.test', PASSWORD);

      // Rotate
      const refreshed = await request(server())
        .post('/auth/refresh')
        .set('Cookie', first.cookies)
        .expect(200);
      expect(refreshed.body.accessToken).toBeTruthy();
      const rotatedCookies = refreshed.headers['set-cookie'] as unknown as string[];
      expect(rotatedCookies.some((c) => c.startsWith('alumbra_rt='))).toBe(true);

      // The pre-rotation cookie no longer maps to a session.
      await request(server()).post('/auth/refresh').set('Cookie', first.cookies).expect(401);

      // The rotated cookie still works.
      await request(server()).post('/auth/refresh').set('Cookie', rotatedCookies).expect(200);
    });

    it('revokes all sessions of the user when a revoked token is reused', async () => {
      const user = await createUserWithPassword(prisma, {
        email: 'ana@alumbra.test',
        password: PASSWORD,
      });
      const sessionA = await login(app, 'ana@alumbra.test', PASSWORD);
      await login(app, 'ana@alumbra.test', PASSWORD); // second device

      await request(server()).post('/auth/logout').set('Cookie', sessionA.cookies).expect(200);
      // Reusing the revoked cookie looks like a leaked token → kill everything.
      await request(server()).post('/auth/refresh').set('Cookie', sessionA.cookies).expect(401);

      const active = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
      expect(active).toBe(0);
    });

    it('returns 401 without a cookie', async () => {
      const res = await request(server()).post('/auth/refresh').expect(401);
      expect(res.body.error).toBe('NO_REFRESH_TOKEN');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session and clears the cookie; refresh stops working', async () => {
      await createUserWithPassword(prisma, { email: 'ana@alumbra.test', password: PASSWORD });
      const { cookies } = await login(app, 'ana@alumbra.test', PASSWORD);

      const out = await request(server()).post('/auth/logout').set('Cookie', cookies).expect(200);
      expect(out.body.ok).toBe(true);

      await request(server()).post('/auth/refresh').set('Cookie', cookies).expect(401);
    });

    it('is idempotent without a session', async () => {
      await request(server()).post('/auth/logout').expect(200);
    });
  });

  describe('role-based authorization', () => {
    it('forbids createMinistry to non-pastors and allows it to pastors', async () => {
      await createUserWithPassword(prisma, { email: 'miembro@alumbra.test', password: PASSWORD });
      await createUserWithPassword(prisma, {
        email: 'pastor@alumbra.test',
        password: PASSWORD,
        isPastor: true,
      });

      const member = await login(app, 'miembro@alumbra.test', PASSWORD);
      const denied = await request(server())
        .post('/graphql')
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({
          query: 'mutation { createMinistry(input: { slug: "oracion", name: "Oración" }) { id } }',
        })
        .expect(200);
      expect(denied.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(await prisma.ministry.count()).toBe(0);

      const pastor = await login(app, 'pastor@alumbra.test', PASSWORD);
      const ok = await request(server())
        .post('/graphql')
        .set('Authorization', `Bearer ${pastor.accessToken}`)
        .send({
          query: 'mutation { createMinistry(input: { slug: "oracion", name: "Oración" }) { id } }',
        })
        .expect(200);
      expect(ok.body.data.createMinistry.id).toBeTruthy();
    });

    it('allows createUser to acogida leaders and forbids it to plain members', async () => {
      const acogida = await prisma.ministry.create({ data: { slug: 'acogida', name: 'Acogida' } });
      const leader = await createUserWithPassword(prisma, {
        email: 'lider@alumbra.test',
        password: PASSWORD,
      });
      await prisma.ministryMembership.create({
        data: { userId: leader.id, ministryId: acogida.id, role: 'LEADER' },
      });
      await createUserWithPassword(prisma, { email: 'miembro@alumbra.test', password: PASSWORD });

      const createUserMutation =
        'mutation { createUser(input: { email: "nuevo@alumbra.test", firstName: "N", lastName: "U" }) { id } }';

      const leaderSession = await login(app, 'lider@alumbra.test', PASSWORD);
      const ok = await request(server())
        .post('/graphql')
        .set('Authorization', `Bearer ${leaderSession.accessToken}`)
        .send({ query: createUserMutation })
        .expect(200);
      expect(ok.body.data.createUser.id).toBeTruthy();

      const memberSession = await login(app, 'miembro@alumbra.test', PASSWORD);
      const denied = await request(server())
        .post('/graphql')
        .set('Authorization', `Bearer ${memberSession.accessToken}`)
        .send({
          query:
            'mutation { createUser(input: { email: "otro@alumbra.test", firstName: "O", lastName: "T" }) { id } }',
        })
        .expect(200);
      expect(denied.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('lets a user update themselves but not others; pastors can update anyone', async () => {
      const ana = await createUserWithPassword(prisma, {
        email: 'ana@alumbra.test',
        password: PASSWORD,
      });
      const otro = await createUserWithPassword(prisma, {
        email: 'otro@alumbra.test',
        password: PASSWORD,
      });
      await createUserWithPassword(prisma, {
        email: 'pastor@alumbra.test',
        password: PASSWORD,
        isPastor: true,
      });

      const anaSession = await login(app, 'ana@alumbra.test', PASSWORD);
      const self = await request(server())
        .post('/graphql')
        .set('Authorization', `Bearer ${anaSession.accessToken}`)
        .send({
          query: `mutation { updateUser(id: "${ana.id}", input: { firstName: "Anita" }) { firstName } }`,
        })
        .expect(200);
      expect(self.body.data.updateUser.firstName).toBe('Anita');

      const denied = await request(server())
        .post('/graphql')
        .set('Authorization', `Bearer ${anaSession.accessToken}`)
        .send({
          query: `mutation { updateUser(id: "${otro.id}", input: { firstName: "Hack" }) { firstName } }`,
        })
        .expect(200);
      expect(denied.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

      const pastorSession = await login(app, 'pastor@alumbra.test', PASSWORD);
      const byPastor = await request(server())
        .post('/graphql')
        .set('Authorization', `Bearer ${pastorSession.accessToken}`)
        .send({
          query: `mutation { updateUser(id: "${otro.id}", input: { firstName: "Otto" }) { firstName } }`,
        })
        .expect(200);
      expect(byPastor.body.data.updateUser.firstName).toBe('Otto');
    });

    it('setUserSignInAllowed is pastor-only and unlocks login', async () => {
      const asistente = await createUserWithPassword(prisma, {
        email: 'asistente@alumbra.test',
        password: PASSWORD,
        baseRole: 'ASISTENTE',
        canSignIn: false,
      });
      await createUserWithPassword(prisma, {
        email: 'pastor@alumbra.test',
        password: PASSWORD,
        isPastor: true,
      });

      await request(server())
        .post('/auth/login')
        .send({ email: 'asistente@alumbra.test', password: PASSWORD })
        .expect(403);

      const pastorSession = await login(app, 'pastor@alumbra.test', PASSWORD);
      const res = await request(server())
        .post('/graphql')
        .set('Authorization', `Bearer ${pastorSession.accessToken}`)
        .send({
          query: `mutation { setUserSignInAllowed(id: "${asistente.id}", allowed: true) { canSignIn } }`,
        })
        .expect(200);
      expect(res.body.data.setUserSignInAllowed.canSignIn).toBe(true);

      await request(server())
        .post('/auth/login')
        .send({ email: 'asistente@alumbra.test', password: PASSWORD })
        .expect(200);
    });
  });
});
