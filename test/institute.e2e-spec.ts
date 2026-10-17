import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createUserWithPassword, login } from './setup/auth-helper';
import { requireLocalDb } from './setup/require-local-db';
import { wipeDb } from './setup/wipe-db';

const PASSWORD = 'super-secret-1';

describe('Instituto Bíblico (e2e)', () => {
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
  const errorMessage = (res: request.Response) => res.body.errors?.[0]?.message as string;

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

    for (const [key, isPastor] of [
      ['pastor', true],
      ['profe', false],
      ['alumno', false],
      ['otro', false],
    ] as const) {
      const email = `${key}@alumbra.test`;
      ids[key] = (await createUserWithPassword(prisma, { email, password: PASSWORD, isPastor })).id;
      tokens[key] = (await login(app, email, PASSWORD)).accessToken;
    }
  });

  afterAll(async () => {
    await wipeDb(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  const ENROLL = `mutation($u: [ID!]!, $r: InstituteRole!) {
    enrollInInstitute(input: { userIds: $u, role: $r }) { id role }
  }`;

  it('solo los pastores nombran profesores; los de afuera no entran', async () => {
    expect(errorCode(await gql('otro', '{ instituteModules { id } }'))).toBe('FORBIDDEN');
    expect(
      (await gql('otro', '{ myInstitute { role canView canManage } }')).body.data.myInstitute,
    ).toEqual({ role: null, canView: false, canManage: false });

    await gql('pastor', ENROLL, { u: [ids.profe], r: 'TEACHER' });
    expect(errorCode(await gql('profe', ENROLL, { u: [ids.otro], r: 'TEACHER' }))).toBe(
      'FORBIDDEN',
    );
    await gql('profe', ENROLL, { u: [ids.alumno], r: 'STUDENT' });

    expect(
      (await gql('alumno', '{ myInstitute { role canView canManage } }')).body.data.myInstitute,
    ).toEqual({ role: 'STUDENT', canView: true, canManage: false });
    expect(errorCode(await gql('alumno', '{ instituteRoster { id } }'))).toBe('FORBIDDEN');
  });

  it('el alumno solo ve lo publicado; entrega, y la nota borrador no la ve', async () => {
    const mod = await gql(
      'profe',
      `mutation { createInstituteModule(input: { title: "Hermenéutica" }) { id order } }`,
    );
    const moduleId = mod.body.data.createInstituteModule.id;

    const CREATE = `mutation($input: InstituteItemInput!) { createInstituteItem(input: $input) { id status } }`;
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const exam = await gql('profe', CREATE, {
      input: {
        moduleId,
        kind: 'EXAM',
        title: 'Examen final',
        maxPoints: 20,
        dueAt: past,
        publishAt: past,
        attachments: [{ kind: 'FORM', title: 'Examen', url: 'https://forms.gle/abc' }],
      },
    });
    expect(exam.body.data.createInstituteItem.status).toBe('PUBLISHED');
    const examId = exam.body.data.createInstituteItem.id;
    const scheduled = await gql('profe', CREATE, {
      input: { moduleId, kind: 'MATERIAL', title: 'Clase 3', publishAt: future },
    });
    expect(scheduled.body.data.createInstituteItem.status).toBe('SCHEDULED');
    await gql('profe', CREATE, { input: { moduleId, kind: 'MATERIAL', title: 'Borrador' } });

    const seen = await gql('alumno', '{ instituteModules { items { title } } }');
    expect(seen.body.data.instituteModules[0].items.map((i: { title: string }) => i.title)).toEqual(
      ['Examen final'],
    );
    const teacherSees = await gql('profe', '{ instituteModules { items { title status } } }');
    expect(teacherSees.body.data.instituteModules[0].items).toHaveLength(3);

    // Entregó después de la fecha: queda marcada tarde.
    const turned = await gql(
      'alumno',
      `mutation($id: ID!) { turnInInstituteItem(itemId: $id) { mySubmission { state late } } }`,
      { id: examId },
    );
    expect(turned.body.data.turnInInstituteItem.mySubmission).toEqual({
      state: 'TURNED_IN',
      late: true,
    });

    const GRADE = `mutation($input: InstituteGradeInput!) { gradeInstituteSubmission(input: $input) { grade draftGrade state } }`;
    expect(
      errorMessage(
        await gql('profe', GRADE, {
          input: { itemId: examId, studentId: ids.alumno, grade: 25, returnToStudent: false },
        }),
      ),
    ).toMatch(/máxima es 20/);
    await gql('profe', GRADE, {
      input: { itemId: examId, studentId: ids.alumno, grade: 18, returnToStudent: false },
    });
    const MINE = '{ instituteModules { items { mySubmission { grade state } } } }';
    expect((await gql('alumno', MINE)).body.data.instituteModules[0].items[0].mySubmission).toEqual(
      {
        grade: null,
        state: 'TURNED_IN',
      },
    );

    const returned = await gql('profe', GRADE, {
      input: { itemId: examId, studentId: ids.alumno, grade: 18, returnToStudent: true },
    });
    expect(returned.body.data.gradeInstituteSubmission).toEqual({
      grade: 18,
      draftGrade: null,
      state: 'RETURNED',
    });
    expect((await gql('alumno', MINE)).body.data.instituteModules[0].items[0].mySubmission).toEqual(
      {
        grade: 18,
        state: 'RETURNED',
      },
    );

    // Ya calificada: no se puede retirar la entrega.
    const reclaim = await gql(
      'alumno',
      `mutation($id: ID!) { turnInInstituteItem(itemId: $id, turnIn: false) { id } }`,
      { id: examId },
    );
    expect(errorMessage(reclaim)).toMatch(/ya fue calificada/);

    const book = await gql(
      'profe',
      '{ instituteGradebook { items { title } rows { student { email } cells { grade state late } } } }',
    );
    expect(book.body.data.instituteGradebook).toEqual({
      items: [{ title: 'Examen final' }],
      rows: [
        {
          student: { email: 'alumno@alumbra.test' },
          cells: [{ grade: 18, state: 'RETURNED', late: true }],
        },
      ],
    });

    const subs = await gql(
      'profe',
      `query($id: ID!) { instituteSubmissions(itemId: $id) { student { email } grade } }`,
      { id: examId },
    );
    expect(subs.body.data.instituteSubmissions).toEqual([
      { student: { email: 'alumno@alumbra.test' }, grade: 18 },
    ]);
  });
  it('el calendario muestra clases y fechas límite solo a los inscritos', async () => {
    const mod = await gql(
      'profe',
      `mutation { createInstituteModule(input: { title: "Panorama AT" }) { id } }`,
    );
    const moduleId = mod.body.data.createInstituteModule.id;
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

    const CLASS = `mutation($input: InstituteClassInput!) { createInstituteClass(input: $input) { id moduleTitle } }`;
    expect(
      errorCode(
        await gql('alumno', CLASS, { input: { moduleId, title: 'Clase 1', startsAt: day(2) } }),
      ),
    ).toBe('FORBIDDEN');
    const created = await gql('profe', CLASS, {
      input: {
        moduleId,
        title: 'Clase 1',
        startsAt: day(2),
        location: 'Salón principal',
        meetingUrl: '',
      },
    });
    expect(created.body.data.createInstituteClass.moduleTitle).toBe('Panorama AT');

    const ITEM = `mutation($input: InstituteItemInput!) { createInstituteItem(input: $input) { id } }`;
    const tarea = await gql('profe', ITEM, {
      input: { moduleId, kind: 'ASSIGNMENT', title: 'Tarea 1', dueAt: day(3), publishAt: day(-1) },
    });
    // Programado para mañana: el alumno todavía no lo ve.
    await gql('profe', ITEM, {
      input: {
        moduleId,
        kind: 'EXAM',
        title: 'Examen programado',
        dueAt: day(4),
        publishAt: day(1),
      },
    });
    await gql('profe', ITEM, {
      input: { moduleId, kind: 'EXAM', title: 'Examen en borrador', dueAt: day(5) },
    });

    const CAL = `query($from: DateTime!, $to: DateTime!) {
      instituteCalendar(from: $from, to: $to) { type title done location }
    }`;
    const range = { from: day(0), to: day(10) };
    const forStudent = await gql('alumno', CAL, range);
    expect(forStudent.body.data.instituteCalendar).toEqual(
      expect.arrayContaining([
        { type: 'CLASS', title: 'Clase 1', done: false, location: 'Salón principal' },
        { type: 'DEADLINE', title: 'Tarea 1', done: false, location: null },
      ]),
    );
    expect(forStudent.body.data.instituteCalendar).toHaveLength(2);
    // El profesor ve también la del examen programado (el borrador no sale).
    expect((await gql('profe', CAL, range)).body.data.instituteCalendar).toHaveLength(3);
    expect((await gql('otro', CAL, range)).body.data.instituteCalendar).toEqual([]);

    await gql('alumno', `mutation($id: ID!) { turnInInstituteItem(itemId: $id) { id } }`, {
      id: tarea.body.data.createInstituteItem.id,
    });
    const after = await gql('alumno', CAL, range);
    expect(
      after.body.data.instituteCalendar.find((e: { title: string }) => e.title === 'Tarea 1').done,
    ).toBe(true);
  });
  it('trae las notas de Google Forms: borrador, última respuesta y sin pisar lo devuelto', async () => {
    const mod = await gql(
      'profe',
      `mutation { createInstituteModule(input: { title: "Forms" }) { id } }`,
    );
    const exam = await gql(
      'profe',
      `mutation($input: InstituteItemInput!) { createInstituteItem(input: $input) { id } }`,
      {
        input: {
          moduleId: mod.body.data.createInstituteModule.id,
          kind: 'EXAM',
          title: 'Examen en Forms',
          maxPoints: 20,
          publishAt: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    );
    const itemId = exam.body.data.createInstituteItem.id;
    const IMPORT = `mutation($input: ImportFormGradesInput!) {
      importInstituteFormGrades(input: $input) {
        responses matched updated skippedReturned unmatched missing maxPoints applied
      }
    }`;
    const responses = [
      // Respondió dos veces: cuenta la última (36 de 40 → 18 de 20).
      { email: 'ALUMNO@alumbra.test', score: 10, submittedAt: '2026-10-01T10:00:00Z' },
      { email: 'alumno@alumbra.test', score: 36, submittedAt: '2026-10-01T11:00:00Z' },
      { email: 'desconocido@gmail.com', score: 40 },
    ];
    const base = {
      itemId,
      responses,
      formTotal: 40,
      returnToStudent: false,
      overwriteReturned: false,
    };

    expect(errorCode(await gql('alumno', IMPORT, { input: { ...base, apply: false } }))).toBe(
      'FORBIDDEN',
    );

    const preview = await gql('profe', IMPORT, { input: { ...base, apply: false } });
    expect(preview.body.data.importInstituteFormGrades).toEqual({
      responses: 2,
      matched: 1,
      updated: 1,
      skippedReturned: 0,
      unmatched: ['desconocido@gmail.com'],
      missing: 0,
      maxPoints: 20,
      applied: false,
    });
    const SUBS = `query($id: ID!) { instituteSubmissions(itemId: $id) { student { email } state grade draftGrade } }`;
    expect(
      (await gql('profe', SUBS, { id: itemId })).body.data.instituteSubmissions[0].draftGrade,
    ).toBeNull();

    await gql('profe', IMPORT, { input: { ...base, apply: true } });
    expect(
      (await gql('profe', SUBS, { id: itemId })).body.data.instituteSubmissions[0],
    ).toMatchObject({
      state: 'TURNED_IN',
      grade: null,
      draftGrade: 18,
    });

    // El profesor la devuelve: una nueva importación no la pisa…
    await gql(
      'profe',
      `mutation($input: InstituteGradeInput!) { gradeInstituteSubmission(input: $input) { grade } }`,
      { input: { itemId, studentId: ids.alumno, grade: 19, returnToStudent: true } },
    );
    const again = await gql('profe', IMPORT, { input: { ...base, apply: true } });
    expect(again.body.data.importInstituteFormGrades).toMatchObject({
      updated: 0,
      skippedReturned: 1,
    });
    // …salvo que lo pida, y devolviéndola de una vez.
    await gql('profe', IMPORT, {
      input: { ...base, overwriteReturned: true, returnToStudent: true, apply: true },
    });
    expect(
      (await gql('profe', SUBS, { id: itemId })).body.data.instituteSubmissions[0],
    ).toMatchObject({
      state: 'RETURNED',
      grade: 18,
      draftGrade: null,
    });
  });
});
