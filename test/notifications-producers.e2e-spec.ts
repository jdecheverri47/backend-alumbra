import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createUserWithPassword, login } from './setup/auth-helper';
import { requireLocalDb } from './setup/require-local-db';
import { wipeDb } from './setup/wipe-db';

const PASSWORD = 'super-secret-1';

/** Qué avisos generan el muro y el Instituto, y a quién. */
describe('Avisos del muro y del Instituto (e2e)', () => {
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

  const titles = async (who: string) =>
    (
      await gql(who, `{ notifications { edges { node { type title body href } } } }`)
    ).body.data.notifications.edges.map(
      (e: { node: { type: string; title: string; body: string | null; href: string } }) => e.node,
    );

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
    for (const [key, isPastor, baseRole] of [
      ['pastor', true, 'MIEMBRO'],
      ['miembro', false, 'MIEMBRO'],
      ['asistente', false, 'ASISTENTE'],
    ] as const) {
      const email = `${key}@alumbra.test`;
      ids[key] = (
        await createUserWithPassword(prisma, {
          email,
          password: PASSWORD,
          isPastor,
          baseRole,
          firstName: key[0].toUpperCase() + key.slice(1),
          lastName: 'Prueba',
        })
      ).id;
      tokens[key] = (await login(app, email, PASSWORD)).accessToken;
    }
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  const POST = `mutation($input: CreatePostInput!) { createPost(input: $input) { id } }`;

  it('un anuncio avisa a quien lo puede ver; un post normal no avisa', async () => {
    await gql('pastor', POST, {
      input: { type: 'ANUNCIO', body: 'Retiro de jóvenes el sábado', membersOnly: true },
    });
    expect(await titles('miembro')).toEqual([
      expect.objectContaining({
        type: 'muro.anuncio.nuevo',
        title: 'Anuncio de Pastor Prueba',
        body: 'Retiro de jóvenes el sábado',
      }),
    ]);
    // Solo para miembros: el asistente no; el autor tampoco.
    expect(await titles('asistente')).toEqual([]);
    expect(await titles('pastor')).toEqual([]);

    await gql('pastor', POST, {
      input: { type: 'ANUNCIO', body: 'Culto el domingo', membersOnly: false },
    });
    expect(await titles('asistente')).toHaveLength(1);

    await gql('pastor', POST, { input: { type: 'POST', body: 'Hola', membersOnly: false } });
    expect(await titles('asistente')).toHaveLength(1);
  });

  it('comentar avisa al autor del post, no a quien comenta', async () => {
    const post = await gql('pastor', POST, {
      input: { type: 'POST', body: 'Oren por mi familia', membersOnly: false },
    });
    const COMMENT = `mutation($p: ID!, $b: String!) { addPostComment(postId: $p, body: $b) { id } }`;
    const postId = post.body.data.createPost.id;

    await gql('asistente', COMMENT, { p: postId, b: 'Estaré orando' });
    await gql('pastor', COMMENT, { p: postId, b: 'Gracias' });

    expect(await titles('pastor')).toEqual([
      expect.objectContaining({
        type: 'muro.comentario',
        title: 'Asistente Prueba comentó tu publicación',
        body: 'Estaré orando',
      }),
    ]);
    expect(await titles('asistente')).toEqual([]);
  });

  it('Instituto: avisa lo publicado (una vez) y la nota devuelta, no el borrador', async () => {
    await prisma.instituteEnrollment.create({ data: { userId: ids.asistente, role: 'STUDENT' } });
    const mod = await gql(
      'pastor',
      `mutation { createInstituteModule(input: { title: "Hermenéutica" }) { id } }`,
    );
    const moduleId = mod.body.data.createInstituteModule.id;
    const CREATE = `mutation($input: InstituteItemInput!) { createInstituteItem(input: $input) { id } }`;
    const UPDATE = `mutation($id: ID!, $input: InstituteItemInput!) { updateInstituteItem(id: $id, input: $input) { id } }`;
    const past = new Date(Date.now() - 60_000).toISOString();

    // Borrador: nada. Al publicarlo, sí. Editarlo ya publicado: nada más.
    const draft = { moduleId, kind: 'ASSIGNMENT', title: 'Ensayo', maxPoints: 20, publishAt: null };
    const created = await gql('pastor', CREATE, { input: draft });
    const itemId = created.body.data.createInstituteItem.id;
    expect(await titles('asistente')).toEqual([]);

    await gql('pastor', UPDATE, { id: itemId, input: { ...draft, publishAt: past } });
    await gql('pastor', UPDATE, {
      id: itemId,
      input: { ...draft, publishAt: past, description: 'Corregido' },
    });
    expect(await titles('asistente')).toEqual([
      expect.objectContaining({
        type: 'instituto.contenido.nuevo',
        title: 'Tarea nueva: Ensayo',
        body: 'Hermenéutica',
        href: `/instituto?item=${itemId}`,
      }),
    ]);
    // Quien no está inscrito no recibe nada.
    expect(await titles('miembro')).toEqual([]);

    const GRADE = `mutation($input: InstituteGradeInput!) { gradeInstituteSubmission(input: $input) { grade } }`;
    const grade = (g: number, returnToStudent: boolean) =>
      gql('pastor', GRADE, {
        input: { itemId, studentId: ids.asistente, grade: g, returnToStudent },
      });
    await grade(15, false);
    expect(await titles('asistente')).toHaveLength(1);

    await grade(17.5, true);
    await grade(17.5, true);
    const [latest, ...rest] = await titles('asistente');
    expect(latest).toMatchObject({
      type: 'instituto.nota.publicada',
      title: 'Tienes nota en "Ensayo"',
      body: '17,5 / 20',
    });
    expect(rest).toHaveLength(1);
  });
});
