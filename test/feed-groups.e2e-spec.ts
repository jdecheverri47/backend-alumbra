import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createUserWithPassword, login } from './setup/auth-helper';
import { requireLocalDb } from './setup/require-local-db';
import { wipeDb } from './setup/wipe-db';

const PASSWORD = 'super-secret-1';

describe('Feed + Groups + Events (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pastorToken: string;
  let miembroToken: string;
  let miembroId: string;

  const gql = (token: string) =>
    request(app.getHttpServer()).post('/graphql').set('Authorization', `Bearer ${token}`);

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

    await createUserWithPassword(prisma, {
      email: 'pastor@alumbra.test',
      password: PASSWORD,
      isPastor: true,
    });
    const miembro = await createUserWithPassword(prisma, {
      email: 'miembro@alumbra.test',
      password: PASSWORD,
    });
    miembroId = miembro.id;
    pastorToken = (await login(app, 'pastor@alumbra.test', PASSWORD)).accessToken;
    miembroToken = (await login(app, 'miembro@alumbra.test', PASSWORD)).accessToken;
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  it('full flow: pastor crea grupo con horario, agrega miembro, crea evento del grupo', async () => {
    const createGroup = await gql(pastorToken)
      .send({
        query: `mutation {
          createGroup(input: { type: MADUREZ, name: "Madurez 1", meetingDay: 4, meetingTime: "19:00", location: "Sede" }) {
            id name leader { email } meetingDay meetingTime
          }
        }`,
      })
      .expect(200);
    const groupId = createGroup.body.data.createGroup.id;
    expect(createGroup.body.data.createGroup.leader.email).toBe('pastor@alumbra.test');

    await gql(pastorToken)
      .send({
        query: `mutation($u: ID!, $g: ID!) {
          addUserToGroup(input: { userId: $u, groupId: $g }) { id user { email } }
        }`,
        variables: { u: miembroId, g: groupId },
      })
      .expect(200);

    // El miembro ve el grupo en myGroups con su horario semanal.
    const myGroups = await gql(miembroToken)
      .send({ query: '{ myGroups { id name meetingDay meetingTime members { user { email } } } }' })
      .expect(200);
    expect(myGroups.body.data.myGroups).toHaveLength(1);
    expect(myGroups.body.data.myGroups[0].meetingDay).toBe(4);

    // Evento del grupo visible para el miembro en el rango.
    const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await gql(pastorToken)
      .send({
        query: `mutation($g: ID!, $d: DateTime!) {
          createEvent(input: { title: "Retiro del grupo", startsAt: $d, groupId: $g }) { id }
        }`,
        variables: { g: groupId, d: startsAt },
      })
      .expect(200);

    const from = new Date().toISOString();
    const to = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const events = await gql(miembroToken)
      .send({
        query: `query($from: DateTime!, $to: DateTime!) {
          events(from: $from, to: $to) { title group { name } }
        }`,
        variables: { from, to },
      })
      .expect(200);
    expect(events.body.data.events.map((e: { title: string }) => e.title)).toContain(
      'Retiro del grupo',
    );
  });

  it('miembro no puede crear grupos ni eventos generales', async () => {
    const denied = await gql(miembroToken)
      .send({
        query: 'mutation { createGroup(input: { type: MADUREZ, name: "Pirata" }) { id } }',
      })
      .expect(200);
    expect(denied.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    const deniedEvent = await gql(miembroToken)
      .send({
        query: `mutation { createEvent(input: { title: "Evento pirata", startsAt: "2026-08-01T10:00:00Z" }) { id } }`,
      })
      .expect(200);
    expect(deniedEvent.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('feed: pastor publica anuncio fijado; miembro no publica pero reacciona y comenta', async () => {
    const permsMiembro = await gql(miembroToken)
      .send({ query: '{ myFeedPermissions { canPost canAnnounce } }' })
      .expect(200);
    expect(permsMiembro.body.data.myFeedPermissions).toEqual({
      canPost: false,
      canAnnounce: false,
    });

    const deniedPost = await gql(miembroToken)
      .send({
        query: 'mutation { createPost(input: { body: "hola" }) { id } }',
      })
      .expect(200);
    expect(deniedPost.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    const anuncio = await gql(pastorToken)
      .send({
        query: `mutation {
          createPost(input: { type: ANUNCIO, body: "Culto especial el domingo", imageUrls: ["/uploads/flyer.jpg"] }) { id }
        }`,
      })
      .expect(200);
    const postId = anuncio.body.data.createPost.id;

    await gql(pastorToken)
      .send({
        query: `mutation($id: ID!) { setPostPinned(id: $id, pinned: true) { id pinnedAt } }`,
        variables: { id: postId },
      })
      .expect(200);

    const pinned = await gql(miembroToken)
      .send({ query: '{ pinnedAnnouncements { id body images { url } } }' })
      .expect(200);
    expect(pinned.body.data.pinnedAnnouncements).toHaveLength(1);
    expect(pinned.body.data.pinnedAnnouncements[0].images[0].url).toBe('/uploads/flyer.jpg');

    await gql(miembroToken)
      .send({
        query: `mutation($id: ID!) { reactToPost(postId: $id, type: AMEN) { id } }`,
        variables: { id: postId },
      })
      .expect(200);
    await gql(miembroToken)
      .send({
        query: `mutation($id: ID!) { addPostComment(postId: $id, body: "¡Allá estaremos!") { id } }`,
        variables: { id: postId },
      })
      .expect(200);

    const feed = await gql(miembroToken)
      .send({
        query: `{
          feed { edges { node { id body author { email } reactionCounts { type count } myReaction commentCount } } }
        }`,
      })
      .expect(200);
    const node = feed.body.data.feed.edges.find(
      (e: { node: { id: string } }) => e.node.id === postId,
    ).node;
    expect(node.reactionCounts).toEqual([{ type: 'AMEN', count: 1 }]);
    expect(node.myReaction).toBe('AMEN');
    expect(node.commentCount).toBe(1);

    const comments = await gql(pastorToken)
      .send({
        query: `query($id: ID!) { postComments(postId: $id) { body author { email } } }`,
        variables: { id: postId },
      })
      .expect(200);
    expect(comments.body.data.postComments[0].author.email).toBe('miembro@alumbra.test');
  });

  it('clases: crear → asistencia con hora → trabajo → entrega → visibilidad del líder', async () => {
    // Grupo propio para este test (el pastor lidera).
    const g = await gql(pastorToken)
      .send({
        query: 'mutation { createGroup(input: { type: MADUREZ, name: "Madurez clases" }) { id } }',
      })
      .expect(200);
    const groupId = g.body.data.createGroup.id;
    await gql(pastorToken)
      .send({
        query: `mutation($u: ID!, $g: ID!) { addUserToGroup(input: { userId: $u, groupId: $g }) { id } }`,
        variables: { u: miembroId, g: groupId },
      })
      .expect(200);

    const created = await gql(pastorToken)
      .send({
        query: `mutation($g: ID!) {
          createGroupSession(input: { groupId: $g, scheduledFor: "2026-07-16T19:00:00-05:00", title: "Clase 1" }) {
            id status startsAt
          }
        }`,
        variables: { g: groupId },
      })
      .expect(200);
    const sessionId = created.body.data.createGroupSession.id;
    expect(created.body.data.createGroupSession.status).toBe('PROGRAMADA');

    // Check-in del miembro: guarda hora de ingreso.
    const checkIn = await gql(pastorToken)
      .send({
        query: `mutation($s: ID!, $u: ID!) {
          checkInToSession(sessionId: $s, userId: $u) { user { email } checkedInAt }
        }`,
        variables: { s: sessionId, u: miembroId },
      })
      .expect(200);
    expect(checkIn.body.data.checkInToSession.user.email).toBe('miembro@alumbra.test');
    expect(checkIn.body.data.checkInToSession.checkedInAt).toBeTruthy();

    // Material + trabajo.
    await gql(pastorToken)
      .send({
        query: `mutation($s: ID!) {
          addSessionMaterial(input: { sessionId: $s, title: "Guía", url: "/uploads/guia.pdf" }) { id }
        }`,
        variables: { s: sessionId },
      })
      .expect(200);
    const assignment = await gql(pastorToken)
      .send({
        query: `mutation($s: ID!) {
          createSessionAssignment(input: { sessionId: $s, title: "Tarea 1" }) { id }
        }`,
        variables: { s: sessionId },
      })
      .expect(200);
    const assignmentId = assignment.body.data.createSessionAssignment.id;

    // El miembro entrega su trabajo.
    await gql(miembroToken)
      .send({
        query: `mutation($a: ID!) {
          submitAssignment(assignmentId: $a, url: "/uploads/mi-tarea.pdf") { id url }
        }`,
        variables: { a: assignmentId },
      })
      .expect(200);

    // El líder ve entregas y asistencia completas; el miembro solo lo suyo.
    const detailQuery = `query($id: ID!) {
      groupSession(id: $id) {
        status
        materials { title }
        assignments { title submissions { user { email } url } mySubmission { url } }
        attendances { user { email } checkedInAt }
      }
    }`;
    const asLeader = await gql(pastorToken)
      .send({ query: detailQuery, variables: { id: sessionId } })
      .expect(200);
    expect(asLeader.body.data.groupSession.assignments[0].submissions).toHaveLength(1);
    expect(asLeader.body.data.groupSession.attendances).toHaveLength(1);

    const asMember = await gql(miembroToken)
      .send({ query: detailQuery, variables: { id: sessionId } })
      .expect(200);
    expect(asMember.body.data.groupSession.assignments[0].mySubmission.url).toBe(
      '/uploads/mi-tarea.pdf',
    );

    // Reprogramar y cancelar.
    const rescheduled = await gql(pastorToken)
      .send({
        query: `mutation($id: ID!) {
          rescheduleGroupSession(id: $id, startsAt: "2026-07-18T10:00:00-05:00", note: "Feriado") { status startsAt }
        }`,
        variables: { id: sessionId },
      })
      .expect(200);
    expect(rescheduled.body.data.rescheduleGroupSession.status).toBe('REPROGRAMADA');

    const canceled = await gql(pastorToken)
      .send({
        query: `mutation($id: ID!) { cancelGroupSession(id: $id) { status } }`,
        variables: { id: sessionId },
      })
      .expect(200);
    expect(canceled.body.data.cancelGroupSession.status).toBe('CANCELADA');
  });

  it('perfil: pastor registra fechas de membresía/bautismo; self-edit de portada', async () => {
    const info = await gql(pastorToken)
      .send({
        query: `mutation($id: ID!) {
          setUserMembershipInfo(id: $id, input: { membershipDate: "2025-03-01T00:00:00Z", baptismDate: "2025-06-15T00:00:00Z" }) {
            membershipDate baptismDate
          }
        }`,
        variables: { id: miembroId },
      })
      .expect(200);
    expect(info.body.data.setUserMembershipInfo.membershipDate).toBeTruthy();

    // El miembro no puede tocar esas fechas…
    const denied = await gql(miembroToken)
      .send({
        query: `mutation($id: ID!) {
          setUserMembershipInfo(id: $id, input: { baptismDate: null }) { id }
        }`,
        variables: { id: miembroId },
      })
      .expect(200);
    expect(denied.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    // …pero sí su propia portada y foto.
    const updated = await gql(miembroToken)
      .send({
        query: `mutation($id: ID!) {
          updateUser(id: $id, input: { photoUrl: "/uploads/foto.jpg", coverUrl: "/uploads/portada.jpg" }) {
            photoUrl coverUrl
          }
        }`,
        variables: { id: miembroId },
      })
      .expect(200);
    expect(updated.body.data.updateUser.coverUrl).toBe('/uploads/portada.jpg');
  });

  it('uploads: requiere auth y valida tipo de archivo', async () => {
    await request(app.getHttpServer())
      .post('/uploads')
      .attach('file', Buffer.from('fake'), { filename: 'x.png', contentType: 'image/png' })
      .expect(401);

    const ok = await request(app.getHttpServer())
      .post('/uploads')
      .set('Authorization', `Bearer ${pastorToken}`)
      .attach('file', Buffer.from('fake-image-bytes'), {
        filename: 'flyer.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(ok.body.url).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);

    await request(app.getHttpServer())
      .post('/uploads')
      .set('Authorization', `Bearer ${pastorToken}`)
      .attach('file', Buffer.from('#!/bin/sh'), {
        filename: 'script.sh',
        contentType: 'application/x-sh',
      })
      .expect(400);
  });
  it('uploads: subida directa (intent + PUT) y lectura', async () => {
    const video = Buffer.from('fake-mp4-bytes');

    await request(app.getHttpServer())
      .post('/uploads/intent')
      .send({ contentType: 'video/mp4', size: video.length })
      .expect(401);

    await request(app.getHttpServer())
      .post('/uploads/intent')
      .set('Authorization', `Bearer ${miembroToken}`)
      .send({ contentType: 'application/x-sh', size: 10 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/uploads/intent')
      .set('Authorization', `Bearer ${miembroToken}`)
      .send({ contentType: 'video/mp4', size: 300 * 1024 * 1024 })
      .expect(413);

    const intent = await request(app.getHttpServer())
      .post('/uploads/intent')
      .set('Authorization', `Bearer ${miembroToken}`)
      .send({ contentType: 'video/mp4', size: video.length, filename: 'culto.MP4' })
      .expect(200);
    expect(intent.body.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.mp4$/);
    expect(intent.body.method).toBe('PUT');

    // Token de otro archivo o tipo distinto: no entra.
    const otherName = intent.body.uploadUrl.replace(
      /direct\/[^?]+/,
      'direct/00000000-0000-0000-0000-000000000000.mp4',
    );
    await request(app.getHttpServer())
      .put(otherName)
      .set('Content-Type', 'video/mp4')
      .send(video)
      .expect(403);
    await request(app.getHttpServer())
      .put(intent.body.uploadUrl)
      .set('Content-Type', 'image/png')
      .send(video)
      .expect(400);

    await request(app.getHttpServer())
      .put(intent.body.uploadUrl)
      .set('Content-Type', 'video/mp4')
      .send(video)
      .expect(200);

    const read = await request(app.getHttpServer()).get(intent.body.url).expect(200);
    expect(Buffer.from(read.body).toString()).toBe('fake-mp4-bytes');

    await request(app.getHttpServer()).get('/uploads/../package.json').expect(404);
    await request(app.getHttpServer())
      .get('/uploads/00000000-0000-0000-0000-000000000000.mp4')
      .expect(404);

    // El post guarda la galería en orden y con su tipo.
    const post = await gql(pastorToken)
      .send({
        query: `mutation($media: [PostMediaInput!]!) {
          createPost(input: { body: "Culto del domingo", media: $media }) {
            images { url kind position }
          }
        }`,
        variables: {
          media: [
            { url: intent.body.url, kind: 'VIDEO' },
            { url: '/uploads/foto.jpg', kind: 'IMAGE' },
          ],
        },
      })
      .expect(200);
    expect(post.body.data.createPost.images).toEqual([
      { url: intent.body.url, kind: 'VIDEO', position: 0 },
      { url: '/uploads/foto.jpg', kind: 'IMAGE', position: 1 },
    ]);
  });
});
