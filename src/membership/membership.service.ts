import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Group, JourneyStage, MembershipJourney, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { EVANGELIO_SLUG, RUTA_SLUG } from '../courses/courses.service';
import { toGroupModel } from '../groups/dto/to-group-model';
import { toUserModel } from '../users/dto/to-user-model';
import { observationSchema, startJourneySchema, submitFinalWorkSchema } from './dto/inputs.schema';
import {
  ChurchFilterInfoModel,
  ChurchObservationModel,
  MembershipJourneyModel,
  RutaProgressModel,
} from './dto/membership.models';

const JOURNEY_INCLUDE = {
  user: true,
  interviewer: true,
  rutaGroup: { include: { leader: true } },
};

type JourneyRow = Prisma.MembershipJourneyGetPayload<{ include: typeof JOURNEY_INCLUDE }>;

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  async myJourney(me: AuthenticatedUser): Promise<MembershipJourneyModel | null> {
    const row = await this.prisma.membershipJourney.findUnique({
      where: { userId: me.sub },
      include: JOURNEY_INCLUDE,
    });
    // El candidato no ve las notas internas, pero sí su propio avance.
    return row ? this.withProgress(row, { includeInternal: false }) : null;
  }

  /** Tablero completo — solo pastores (guard en el resolver). */
  async list(stage?: JourneyStage): Promise<MembershipJourneyModel[]> {
    const rows = await this.prisma.membershipJourney.findMany({
      where: stage ? { stage } : {},
      include: JOURNEY_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    return Promise.all(rows.map((row) => this.withProgress(row, { includeInternal: true })));
  }

  async myInterviews(me: AuthenticatedUser): Promise<MembershipJourneyModel[]> {
    const rows = await this.prisma.membershipJourney.findMany({
      where: { interviewerId: me.sub },
      include: JOURNEY_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    return Promise.all(rows.map((row) => this.withProgress(row, { includeInternal: true })));
  }

  /**
   * Expediente de una persona. Solo líderes y pastores (y la propia persona);
   * las notas internas quedan restringidas a pastores y al entrevistador asignado.
   */
  async journeyOf(me: AuthenticatedUser, userId: string): Promise<MembershipJourneyModel | null> {
    const row = await this.prisma.membershipJourney.findUnique({
      where: { userId },
      include: JOURNEY_INCLUDE,
    });
    if (!row) return null;
    const internal = me.isPastor || row.interviewerId === me.sub;
    const mayView = internal || me.user.isLeader || row.userId === me.sub;
    if (!mayView) {
      throw new ForbiddenException({ error: 'FORBIDDEN', message: 'No autorizado.' });
    }
    return this.withProgress(row, { includeInternal: internal });
  }

  /** Filtro abierto de un candidato, para el formulario de observaciones de los miembros. */
  async churchFilterFor(
    me: AuthenticatedUser,
    userId: string,
  ): Promise<ChurchFilterInfoModel | null> {
    if (me.baseRole !== 'MIEMBRO' && !me.isPastor) return null;
    const row = await this.prisma.membershipJourney.findFirst({
      where: { userId, stage: 'FILTRO_IGLESIA' },
      include: { user: true },
    });
    if (!row || !row.churchFilterOpenedAt) return null;
    const mine = await this.prisma.churchObservation.findUnique({
      where: { journeyId_authorId: { journeyId: row.id, authorId: me.sub } },
    });
    return {
      journeyId: row.id,
      candidate: toUserModel(row.user),
      openedAt: row.churchFilterOpenedAt,
      myObservation: mine?.body ?? null,
    };
  }

  /** Observaciones con autor — solo pastores (guard en el resolver). */
  async observations(journeyId: string): Promise<ChurchObservationModel[]> {
    const rows = await this.prisma.churchObservation.findMany({
      where: { journeyId },
      include: { author: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      author: toUserModel(row.author),
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  // ── Transiciones ───────────────────────────────────────────────────────────

  /** Registra la pre-entrevista. Pastor o líder de ministerio (acogida). */
  async start(me: AuthenticatedUser, raw: unknown): Promise<MembershipJourneyModel> {
    const data = startJourneySchema.parse(raw);
    if (!me.isPastor) {
      const leadsMinistry = await this.prisma.ministryMembership.findFirst({
        where: { userId: me.sub, role: 'LEADER', leftAt: null },
      });
      if (!leadsMinistry) {
        throw new ForbiddenException({
          error: 'FORBIDDEN',
          message: 'Solo pastores o líderes de ministerio registran pre-entrevistas.',
        });
      }
    }

    const user = await this.prisma.user.findFirst({ where: { id: data.userId } });
    if (!user) throw new NotFoundException(`User ${data.userId} not found.`);
    if (user.baseRole === 'MIEMBRO') {
      throw new BadRequestException('Esta persona ya es miembro.');
    }

    // El expediente lo manejan líderes y pastores: el entrevistador debe serlo.
    if (data.interviewerId && data.interviewerId !== me.sub) {
      const interviewer = await this.prisma.user.findFirst({ where: { id: data.interviewerId } });
      if (!interviewer) throw new NotFoundException(`User ${data.interviewerId} not found.`);
      if (!interviewer.isPastor && !interviewer.isLeader) {
        throw new BadRequestException('El entrevistador debe ser un líder o un pastor.');
      }
    }

    try {
      const row = await this.prisma.membershipJourney.create({
        data: {
          userId: data.userId,
          interviewerId: data.interviewerId ?? me.sub,
          preInterviewAt: data.preInterviewAt ?? new Date(),
          preInterviewNotes: data.preInterviewNotes,
        },
        include: JOURNEY_INCLUDE,
      });
      return this.toModel(row, { includeInternal: true });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Esta persona ya tiene un proceso de membresía.');
      }
      throw e;
    }
  }

  /** El entrevistador (o un pastor) valida la entrada a la Ruta. Exige Evangelio terminado. */
  async validate(
    me: AuthenticatedUser,
    journeyId: string,
    approved: boolean,
    notes?: string,
  ): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    this.assertInterviewerOrPastor(me, journey);
    this.assertStage(journey, 'PRE_ENTREVISTA');

    if (approved) {
      const evangelio = await this.prisma.courseCompletion.findFirst({
        where: { userId: journey.userId, course: { slug: EVANGELIO_SLUG } },
      });
      if (!evangelio) {
        throw new BadRequestException(
          'Para entrar a la Ruta debe tener certificado el curso de Evangelio.',
        );
      }
    }

    const row = await this.prisma.membershipJourney.update({
      where: { id: journeyId },
      data: {
        stage: approved ? 'VALIDADO' : 'NO_CONTINUA',
        validatedAt: approved ? new Date() : null,
        notes: notes ?? journey.notes,
      },
      include: JOURNEY_INCLUDE,
    });
    return this.toModel(row, { includeInternal: true });
  }

  /** Asigna el candidato a una cohorte de la Ruta (lo agrega al grupo). */
  async assignToRuta(
    me: AuthenticatedUser,
    journeyId: string,
    groupId: string,
  ): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    this.assertInterviewerOrPastor(me, journey);
    this.assertStage(journey, 'VALIDADO');

    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { course: true },
    });
    if (!group) throw new NotFoundException(`Group ${groupId} not found.`);
    if (group.course?.slug !== RUTA_SLUG || group.archivedAt) {
      throw new BadRequestException('El grupo debe ser una cohorte activa de la Ruta.');
    }

    const activeMembership = await this.prisma.groupMembership.findFirst({
      where: { groupId, userId: journey.userId, leftAt: null },
    });
    if (!activeMembership) {
      await this.prisma.groupMembership.create({
        data: { groupId, userId: journey.userId, addedById: me.sub },
      });
    }

    const row = await this.prisma.membershipJourney.update({
      where: { id: journeyId },
      data: { stage: 'EN_RUTA', rutaGroupId: groupId },
      include: JOURNEY_INCLUDE,
    });
    return this.toModel(row, { includeInternal: true });
  }

  /** El líder de la cohorte (o pastor) marca la Ruta como terminada. */
  async completeRuta(me: AuthenticatedUser, journeyId: string): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    this.assertStage(journey, 'EN_RUTA');
    const leadsCohort = journey.rutaGroup && journey.rutaGroup.leaderId === me.sub;
    if (!me.isPastor && !leadsCohort) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo el líder de la cohorte o un pastor puede marcar la Ruta como terminada.',
      });
    }

    const row = await this.prisma.membershipJourney.update({
      where: { id: journeyId },
      data: { stage: 'ENTREGA_FINAL', rutaCompletedAt: new Date() },
      include: JOURNEY_INCLUDE,
    });
    return this.toModel(row, { includeInternal: true });
  }

  /** El candidato entrega ensayo (~2000 palabras), testimonio e imagen. */
  async submitFinalWork(me: AuthenticatedUser, raw: unknown): Promise<MembershipJourneyModel> {
    const data = submitFinalWorkSchema.parse(raw);
    const journey = await this.prisma.membershipJourney.findUnique({
      where: { userId: me.sub },
      include: JOURNEY_INCLUDE,
    });
    if (!journey) throw new NotFoundException('No tienes un proceso de membresía activo.');
    this.assertStage(journey, 'ENTREGA_FINAL');

    const row = await this.prisma.membershipJourney.update({
      where: { id: journey.id },
      data: { ...data, finalSubmittedAt: new Date() },
      include: JOURNEY_INCLUDE,
    });
    return this.toModel(row, { includeInternal: false });
  }

  /** Abre el filtro de iglesia y publica el anuncio fijado. Solo pastores (guard en resolver). */
  async openChurchFilter(
    me: AuthenticatedUser,
    journeyId: string,
  ): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    this.assertStage(journey, 'ENTREGA_FINAL');
    if (!journey.finalSubmittedAt) {
      throw new BadRequestException(
        'El candidato aún no ha entregado ensayo, testimonio e imagen.',
      );
    }

    const candidate = journey.user;
    const [row] = await this.prisma.$transaction([
      this.prisma.membershipJourney.update({
        where: { id: journeyId },
        data: { stage: 'FILTRO_IGLESIA', churchFilterOpenedAt: new Date() },
        include: JOURNEY_INCLUDE,
      }),
      this.prisma.post.create({
        data: {
          authorId: me.sub,
          type: 'ANUNCIO',
          pinnedAt: new Date(),
          body:
            `🕊️ Filtro de iglesia: ${candidate.firstName} ${candidate.lastName} está culminando su ` +
            `Ruta de Crecimiento y quiere hacer pacto de membresía. Si eres miembro y tienes alguna ` +
            `anotación u observación sobre su carácter, entra a su perfil y déjala en el formulario.`,
        },
      }),
    ]);
    return this.toModel(row, { includeInternal: true });
  }

  /** Un miembro deja (o actualiza) su observación sobre el candidato. */
  async addObservation(me: AuthenticatedUser, raw: unknown): Promise<boolean> {
    const { journeyId, body } = observationSchema.parse(raw);
    if (me.baseRole !== 'MIEMBRO' && !me.isPastor) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo los miembros participan del filtro de iglesia.',
      });
    }
    const journey = await this.getOrThrow(journeyId);
    this.assertStage(journey, 'FILTRO_IGLESIA');
    if (journey.userId === me.sub) {
      throw new BadRequestException('No puedes dejar observaciones sobre tu propio proceso.');
    }

    await this.prisma.churchObservation.upsert({
      where: { journeyId_authorId: { journeyId, authorId: me.sub } },
      create: { journeyId, authorId: me.sub, body },
      update: { body },
    });
    return true;
  }

  /** Cierra el filtro. Solo pastores (guard en resolver). */
  async closeChurchFilter(
    journeyId: string,
    passed: boolean,
    pastoralInterviewAt?: Date,
  ): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    this.assertStage(journey, 'FILTRO_IGLESIA');

    const row = await this.prisma.membershipJourney.update({
      where: { id: journeyId },
      data: {
        stage: passed ? 'ENTREVISTA_PASTORAL' : 'NO_CONTINUA',
        churchFilterClosedAt: new Date(),
        churchFilterPassed: passed,
        pastoralInterviewAt: passed ? (pastoralInterviewAt ?? null) : null,
      },
      include: JOURNEY_INCLUDE,
    });
    return this.toModel(row, { includeInternal: true });
  }

  /** Firma del pacto: la persona pasa a ser MIEMBRO. Solo pastores (guard en resolver). */
  async signCovenant(journeyId: string, date?: Date): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    this.assertStage(journey, 'ENTREVISTA_PASTORAL');
    const signedAt = date ?? new Date();

    const [row] = await this.prisma.$transaction([
      this.prisma.membershipJourney.update({
        where: { id: journeyId },
        data: { stage: 'MIEMBRO', covenantSignedAt: signedAt },
        include: JOURNEY_INCLUDE,
      }),
      this.prisma.user.update({
        where: { id: journey.userId },
        data: { baseRole: 'MIEMBRO', canSignIn: true, membershipDate: signedAt },
      }),
    ]);
    return this.toModel(row, { includeInternal: true });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getOrThrow(id: string): Promise<JourneyRow> {
    const journey = await this.prisma.membershipJourney.findUnique({
      where: { id },
      include: JOURNEY_INCLUDE,
    });
    if (!journey) throw new NotFoundException(`Journey ${id} not found.`);
    return journey;
  }

  private assertStage(journey: MembershipJourney, expected: JourneyStage): void {
    if (journey.stage !== expected) {
      throw new BadRequestException(
        `El proceso está en etapa ${journey.stage}; esta acción requiere ${expected}.`,
      );
    }
  }

  /** Trazabilidad: asistencia y tareas del candidato, clase por clase de su cohorte. */
  private async rutaProgress(journey: JourneyRow): Promise<RutaProgressModel | null> {
    if (!journey.rutaGroupId) return null;

    const sessions = await this.prisma.groupSession.findMany({
      where: { groupId: journey.rutaGroupId },
      include: {
        lesson: { include: { topic: true } },
        assignments: {
          include: { submissions: { where: { userId: journey.userId } } },
          orderBy: { createdAt: 'asc' },
        },
        attendances: { where: { userId: journey.userId } },
      },
      orderBy: { startsAt: 'asc' },
    });

    const classes = sessions.map((session) => ({
      sessionId: session.id,
      lessonId: session.lessonId,
      startsAt: session.startsAt,
      status: session.status,
      title: session.title ?? session.lesson?.title ?? null,
      topicTitle: session.lesson?.topic.title ?? null,
      attended: session.attendances.length > 0,
      checkedInAt: session.attendances[0]?.checkedInAt ?? null,
      assignments: session.assignments.map((assignment) => ({
        title: assignment.title,
        submitted: assignment.submissions.length > 0,
        submittedAt: assignment.submissions[0]?.submittedAt ?? null,
        url: assignment.submissions[0]?.url ?? null,
      })),
    }));

    const active = classes.filter((c) => c.status !== 'CANCELADA');
    return {
      sessionsTotal: active.length,
      sessionsAttended: active.filter((c) => c.attended).length,
      assignmentsTotal: active.reduce((sum, c) => sum + c.assignments.length, 0),
      assignmentsSubmitted: active.reduce(
        (sum, c) => sum + c.assignments.filter((a) => a.submitted).length,
        0,
      ),
      classes,
    };
  }

  private async withProgress(
    row: JourneyRow,
    opts: { includeInternal: boolean },
  ): Promise<MembershipJourneyModel> {
    return { ...this.toModel(row, opts), rutaProgress: await this.rutaProgress(row) };
  }

  private assertInterviewerOrPastor(me: AuthenticatedUser, journey: MembershipJourney): void {
    if (!me.isPastor && journey.interviewerId !== me.sub) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Solo el entrevistador asignado o un pastor puede hacer esto.',
      });
    }
  }

  private toModel(
    row: JourneyRow & { rutaGroup: (Group & { leader: User }) | null },
    opts: { includeInternal: boolean },
  ): MembershipJourneyModel {
    return {
      id: row.id,
      stage: row.stage,
      user: toUserModel(row.user),
      interviewer: row.interviewer ? toUserModel(row.interviewer) : null,
      preInterviewAt: row.preInterviewAt,
      preInterviewNotes: opts.includeInternal ? row.preInterviewNotes : null,
      validatedAt: row.validatedAt,
      rutaGroup: row.rutaGroup ? toGroupModel(row.rutaGroup) : null,
      rutaCompletedAt: row.rutaCompletedAt,
      essayUrl: row.essayUrl,
      testimony: row.testimony,
      imageUrl: row.imageUrl,
      finalSubmittedAt: row.finalSubmittedAt,
      churchFilterOpenedAt: row.churchFilterOpenedAt,
      churchFilterClosedAt: row.churchFilterClosedAt,
      churchFilterPassed: row.churchFilterPassed,
      pastoralInterviewAt: row.pastoralInterviewAt,
      covenantSignedAt: row.covenantSignedAt,
      notes: opts.includeInternal ? row.notes : null,
      createdAt: row.createdAt,
    };
  }
}
