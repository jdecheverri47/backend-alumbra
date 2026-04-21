import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const gql = (app: INestApplication) => request(app.getHttpServer()).post('/graphql');

describe('Spec A happy path (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$executeRawUnsafe('DELETE FROM "Ministry"');
    // Recreate Acogida since we just wiped it
    await prisma.ministry.create({
      data: { slug: 'acogida', name: 'Acogida' },
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$executeRawUnsafe('DELETE FROM "Ministry"');
    await prisma.$disconnect();
    await app.close();
  });

  it('creates a user, adds to Acogida, filters, removes, soft-deletes', async () => {
    // Fetch Acogida
    const ministryResp = await gql(app)
      .send({ query: '{ ministry(slug: "acogida") { id slug } }' })
      .expect(200);
    const ministryId = ministryResp.body.data.ministry.id;
    expect(ministryResp.body.data.ministry.slug).toBe('acogida');

    // Create a user
    const createResp = await gql(app)
      .send({
        query: `mutation { createUser(input: { email: "e2e@alumbra.test", firstName: "E2E", lastName: "Tester" }) { id email baseRole } }`,
      })
      .expect(200);
    const userId = createResp.body.data.createUser.id;
    expect(createResp.body.data.createUser.email).toBe('e2e@alumbra.test');
    expect(createResp.body.data.createUser.baseRole).toBe('ASISTENTE');

    // Add to Acogida
    const addResp = await gql(app)
      .send({
        query: `mutation AddMember($userId: ID!, $ministryId: ID!) {
          addUserToMinistry(input: { userId: $userId, ministryId: $ministryId, role: MEMBER }) {
            id role user { id } ministry { slug }
          }
        }`,
        variables: { userId, ministryId },
      })
      .expect(200);
    const membershipId = addResp.body.data.addUserToMinistry.id;
    expect(addResp.body.data.addUserToMinistry.ministry.slug).toBe('acogida');

    // Filter users by ministryId
    const filterResp = await gql(app)
      .send({
        query: `query ($mid: String!) {
          users(filter: { ministryId: $mid }) { edges { node { id email } } }
        }`,
        variables: { mid: ministryId },
      })
      .expect(200);
    expect(filterResp.body.data.users.edges).toHaveLength(1);
    expect(filterResp.body.data.users.edges[0].node.id).toBe(userId);

    // Remove membership
    const removeResp = await gql(app)
      .send({
        query: `mutation ($id: ID!) { removeUserFromMinistry(membershipId: $id) { leftAt } }`,
        variables: { id: membershipId },
      })
      .expect(200);
    expect(removeResp.body.data.removeUserFromMinistry.leftAt).not.toBeNull();

    // Filter now excludes the user
    const filterAfterResp = await gql(app)
      .send({
        query: `query ($mid: String!) {
          users(filter: { ministryId: $mid }) { edges { node { id } } }
        }`,
        variables: { mid: ministryId },
      })
      .expect(200);
    expect(filterAfterResp.body.data.users.edges).toHaveLength(0);

    // Soft-delete user
    await gql(app)
      .send({
        query: `mutation ($id: ID!) { softDeleteUser(id: $id) { id } }`,
        variables: { id: userId },
      })
      .expect(200);

    // user() returns null
    const finalResp = await gql(app)
      .send({
        query: `query ($id: ID!) { user(id: $id) { id } }`,
        variables: { id: userId },
      })
      .expect(200);
    expect(finalResp.body.data.user).toBeNull();
  });

  it('rejects duplicate addUserToMinistry', async () => {
    const ministry = await prisma.ministry.findUniqueOrThrow({ where: { slug: 'acogida' } });
    const createResp = await gql(app)
      .send({
        query: `mutation { createUser(input: { email: "dup@alumbra.test", firstName: "D", lastName: "U" }) { id } }`,
      })
      .expect(200);
    const userId = createResp.body.data.createUser.id;

    await gql(app)
      .send({
        query: `mutation ($u: ID!, $m: ID!) { addUserToMinistry(input: { userId: $u, ministryId: $m, role: MEMBER }) { id } }`,
        variables: { u: userId, m: ministry.id },
      })
      .expect(200);

    const dup = await gql(app)
      .send({
        query: `mutation ($u: ID!, $m: ID!) { addUserToMinistry(input: { userId: $u, ministryId: $m, role: MEMBER }) { id } }`,
        variables: { u: userId, m: ministry.id },
      })
      .expect(200);
    expect(dup.body.errors?.[0]?.message).toMatch(/active membership/i);
  });

  it('rejects creating a ministry with a duplicate slug', async () => {
    const resp = await gql(app)
      .send({
        query: `mutation { createMinistry(input: { slug: "acogida", name: "Duplicate" }) { id } }`,
      })
      .expect(200);
    expect(resp.body.errors?.[0]?.message).toMatch(/slug/i);
  });
});
