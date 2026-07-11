import { Test } from '@nestjs/testing';
import { PrismaClient, User } from '@prisma/client';
import { seedCourses } from '../../prisma/seed-courses';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { wipeDb } from '../../test/setup/wipe-db';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CoursesService } from '../courses/courses.service';
import { GroupSessionsService } from '../group-sessions/group-sessions.service';
import { GroupsService } from '../groups/groups.service';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from './membership.service';

const asAuth = (u: User): AuthenticatedUser => ({
  sub: u.id,
  email: u.email,
  isPastor: u.isPastor,
  baseRole: u.baseRole,
  user: u,
});

describe('Membership pipeline (integration)', () => {
  let membership: MembershipService;
  let courses: CoursesService;
  let groups: GroupsService;
  let sessions: GroupSessionsService;
  let prisma: PrismaService;

  let pastor: User;
  let entrevistador: User; // líder de acogida, no pastor
  let candidato: User; // ASISTENTE
  let miembro: User;
  let rutaCohortId: string;
  let evangelioCourseId: string;
  let rutaCourseId: string;

  const seedBase = async () => {
    await seedCourses(prisma as unknown as PrismaClient);
    evangelioCourseId = (await prisma.course.findUniqueOrThrow({ where: { slug: 'evangelio' } }))
      .id;
    rutaCourseId = (await prisma.course.findUniqueOrThrow({ where: { slug: 'ruta-crecimiento' } }))
      .id;

    pastor = await prisma.user.create({
      data: {
        email: 'pastor@x.com',
        firstName: 'P',
        lastName: 'Uno',
        isPastor: true,
        baseRole: 'MIEMBRO',
      },
    });
    entrevistador = await prisma.user.create({
      data: { email: 'entrevistador@x.com', firstName: 'E', lastName: 'Dos', baseRole: 'MIEMBRO' },
    });
    const acogida = await prisma.ministry.create({ data: { slug: 'acogida', name: 'Acogida' } });
    await prisma.ministryMembership.create({
      data: { userId: entrevistador.id, ministryId: acogida.id, role: 'LEADER' },
    });
    candidato = await prisma.user.create({
      data: { email: 'candidato@x.com', firstName: 'C', lastName: 'Tres', baseRole: 'ASISTENTE' },
    });
    miembro = await prisma.user.create({
      data: { email: 'miembro@x.com', firstName: 'M', lastName: 'Cuatro', baseRole: 'MIEMBRO' },
    });

    const cohorte = await groups.create(asAuth(pastor), {
      type: 'CURSO',
      name: 'Ruta 2026-1',
      courseId: rutaCourseId,
    });
    rutaCohortId = cohorte.id;
  };

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MembershipService,
        CoursesService,
        GroupsService,
        GroupSessionsService,
        PrismaService,
      ],
    }).compile();
    membership = moduleRef.get(MembershipService);
    courses = moduleRef.get(CoursesService);
    groups = moduleRef.get(GroupsService);
    sessions = moduleRef.get(GroupSessionsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await wipeDb(prisma as unknown as PrismaClient);
    await seedBase();
  });

  afterAll(async () => {
    await wipeDb(prisma as unknown as PrismaClient);
    await prisma.$disconnect();
  });

  it('recorre el pipeline completo hasta MIEMBRO con todos sus side effects', async () => {
    // 1. Pre-entrevista (la registra el líder de acogida).
    const journey = await membership.start(asAuth(entrevistador), {
      userId: candidato.id,
      preInterviewNotes: 'Buena disposición',
    });
    expect(journey.stage).toBe('PRE_ENTREVISTA');
    expect(journey.interviewer?.id).toBe(entrevistador.id);

    // 2. Validar sin Evangelio terminado → rechazado.
    await expect(membership.validate(asAuth(entrevistador), journey.id, true)).rejects.toThrow(
      /Evangelio/i,
    );

    // Certificamos Evangelio y validamos.
    await courses.certifyCompletion(asAuth(pastor), candidato.id, evangelioCourseId);
    const validated = await membership.validate(asAuth(entrevistador), journey.id, true);
    expect(validated.stage).toBe('VALIDADO');

    // 3. Asignar a cohorte: queda EN_RUTA y como miembro del grupo.
    const enRuta = await membership.assignToRuta(asAuth(entrevistador), journey.id, rutaCohortId);
    expect(enRuta.stage).toBe('EN_RUTA');
    expect(enRuta.rutaGroup?.id).toBe(rutaCohortId);
    const membershipRow = await prisma.groupMembership.findFirst({
      where: { groupId: rutaCohortId, userId: candidato.id, leftAt: null },
    });
    expect(membershipRow).not.toBeNull();

    // 4. Termina la ruta (el pastor, que lidera la cohorte).
    const entrega = await membership.completeRuta(asAuth(pastor), journey.id);
    expect(entrega.stage).toBe('ENTREGA_FINAL');

    // 5. El candidato entrega ensayo + testimonio + imagen.
    const submitted = await membership.submitFinalWork(asAuth(candidato), {
      essayUrl: '/uploads/ensayo.pdf',
      testimony:
        'Mi vida cambió cuando conocí a Cristo. Este es mi testimonio con suficiente longitud.',
      imageUrl: '/uploads/foto.jpg',
    });
    expect(submitted.finalSubmittedAt).not.toBeNull();

    // 6. El pastor abre el filtro → anuncio fijado automático en el feed.
    const filtro = await membership.openChurchFilter(asAuth(pastor), journey.id);
    expect(filtro.stage).toBe('FILTRO_IGLESIA');
    const anuncio = await prisma.post.findFirst({ where: { type: 'ANUNCIO' } });
    expect(anuncio?.pinnedAt).not.toBeNull();
    expect(anuncio?.body).toContain('C Tres');

    // 7. Observaciones: un miembro sí; el candidato sobre sí mismo no.
    await membership.addObservation(asAuth(miembro), {
      journeyId: journey.id,
      body: 'Persona fiel y constante, la recomiendo.',
    });
    await expect(
      membership.addObservation(asAuth(candidato), { journeyId: journey.id, body: 'Soy genial' }),
    ).rejects.toThrow(/miembros|propio/i);

    const observations = await membership.observations(journey.id);
    expect(observations).toHaveLength(1);
    expect(observations[0].author.id).toBe(miembro.id);

    // El filtro se ve desde el perfil del candidato para un miembro.
    const filterInfo = await membership.churchFilterFor(asAuth(miembro), candidato.id);
    expect(filterInfo?.journeyId).toBe(journey.id);
    expect(filterInfo?.myObservation).toContain('fiel');

    // 8. Pasa el filtro → entrevista pastoral.
    const interview = await membership.closeChurchFilter(journey.id, true, new Date('2026-08-01'));
    expect(interview.stage).toBe('ENTREVISTA_PASTORAL');

    // 9. Pacto firmado → MIEMBRO con side effects en el usuario.
    const done = await membership.signCovenant(journey.id, new Date('2026-08-08'));
    expect(done.stage).toBe('MIEMBRO');
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: candidato.id } });
    expect(updated.baseRole).toBe('MIEMBRO');
    expect(updated.canSignIn).toBe(true);
    expect(updated.membershipDate?.toISOString()).toContain('2026-08-08');
  });

  it('valida etapas y permisos: transiciones fuera de orden se rechazan', async () => {
    const journey = await membership.start(asAuth(pastor), { userId: candidato.id });

    // No se puede entregar trabajo final antes de ENTREGA_FINAL.
    await expect(
      membership.submitFinalWork(asAuth(candidato), {
        essayUrl: '/uploads/e.pdf',
        testimony: 'x'.repeat(60),
        imageUrl: '/uploads/i.jpg',
      }),
    ).rejects.toThrow(/etapa/i);

    // Ni abrir el filtro sin entrega.
    await expect(membership.openChurchFilter(asAuth(pastor), journey.id)).rejects.toThrow(/etapa/i);

    // Un miembro cualquiera no valida (no es el entrevistador ni pastor).
    await expect(membership.validate(asAuth(miembro), journey.id, true)).rejects.toThrow(
      /entrevistador|pastor/i,
    );

    // No hay dos procesos para la misma persona.
    await expect(membership.start(asAuth(pastor), { userId: candidato.id })).rejects.toThrow(
      /ya tiene/i,
    );
  });

  it('no deja agregar a una cohorte de la Ruta a alguien sin proceso validado', async () => {
    await expect(
      groups.addMember(asAuth(pastor), { userId: candidato.id, groupId: rutaCohortId }),
    ).rejects.toThrow(/validad/i);
  });

  it('la Ruta respeta el orden del temario y genera las tareas de la plantilla', async () => {
    const topics = await prisma.courseTopic.findMany({
      where: { courseId: rutaCourseId },
      orderBy: { order: 'asc' },
      include: { lessons: { orderBy: { order: 'asc' } } },
    });
    const [firstLesson, secondLesson] = topics.flatMap((t) => t.lessons);

    // Saltarse la primera clase → rechazado.
    await expect(
      sessions.create(asAuth(pastor), {
        groupId: rutaCohortId,
        scheduledFor: new Date('2026-07-16T19:00:00-05:00'),
        lessonId: secondLesson.id,
      }),
    ).rejects.toThrow(/orden/i);

    // La primera clase pasa y trae sus tareas de la plantilla.
    const session = await sessions.create(asAuth(pastor), {
      groupId: rutaCohortId,
      scheduledFor: new Date('2026-07-16T19:00:00-05:00'),
      lessonId: firstLesson.id,
    });
    expect(session.lesson?.id).toBe(firstLesson.id);
    expect(session.title).toBe(firstLesson.title);
    expect(session.assignments.length).toBeGreaterThan(0);

    // Ahora la segunda ya se puede programar.
    const second = await sessions.create(asAuth(pastor), {
      groupId: rutaCohortId,
      scheduledFor: new Date('2026-07-23T19:00:00-05:00'),
      lessonId: secondLesson.id,
    });
    expect(second.lesson?.id).toBe(secondLesson.id);
  });

  it('las cohortes de la Ruta las dirige un líder asignado o un pastor', async () => {
    // Un miembro sin rol de líder no puede dirigir la Ruta.
    await expect(
      groups.create(asAuth(pastor), {
        type: 'CURSO',
        name: 'Ruta pirata',
        courseId: rutaCourseId,
        leaderId: miembro.id,
      }),
    ).rejects.toThrow(/líder asignado|pastor/i);

    // El pastor le otorga el rol → ya puede dirigir la cohorte.
    await prisma.user.update({ where: { id: miembro.id }, data: { isLeader: true } });
    const cohorte = await groups.create(asAuth(pastor), {
      type: 'CURSO',
      name: 'Ruta 2026-2',
      courseId: rutaCourseId,
      leaderId: miembro.id,
    });
    expect(cohorte.leader.id).toBe(miembro.id);
  });

  it('certifyCourseCompletion exige liderar cohorte del curso o ser pastor', async () => {
    await expect(
      courses.certifyCompletion(asAuth(miembro), candidato.id, evangelioCourseId),
    ).rejects.toThrow(/líder|pastor/i);

    // El líder de una cohorte de Evangelio sí puede.
    await groups.create(asAuth(pastor), {
      type: 'CURSO',
      name: 'Evangelio 2026-1',
      courseId: evangelioCourseId,
      leaderId: miembro.id,
    });
    const completion = await courses.certifyCompletion(
      asAuth(miembro),
      candidato.id,
      evangelioCourseId,
    );
    expect(completion.course.slug).toBe('evangelio');
    expect(await courses.hasCompleted(candidato.id, 'evangelio')).toBe(true);
  });
});
