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
});
