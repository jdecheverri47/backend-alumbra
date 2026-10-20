import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Group, JourneyStage, MembershipJourney, Prisma, User } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
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
  assignedLeader: true,
  rutaGroup: { include: { leader: true } },
};

type JourneyRow = Prisma.MembershipJourneyGetPayload<{ include: typeof JOURNEY_INCLUDE }>;

/** "lunes 3 de noviembre, 7:00 p. m.", en hora de Colombia. */
function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(d);
}

const fullName = (u: Pick<User, 'firstName' | 'lastName'>) => `${u.firstName} ${u.lastName}`;

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

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
   * Expediente de una persona: quien acompaña la Ruta (y la propia persona).
   * Las notas internas, solo quien administra la Ruta y el entrevistador asignado.
   */
  async journeyOf(me: AuthenticatedUser, userId: string): Promise<MembershipJourneyModel | null> {
    const row = await this.prisma.membershipJourney.findUnique({
      where: { userId },
      include: JOURNEY_INCLUDE,
    });
    if (!row) return null;
    const internal =
      row.interviewerId === me.sub || (await this.permissions.can(me, 'ruta.administrar'));
    const mayView =
      internal || row.userId === me.sub || (await this.permissions.can(me, 'ruta.entrevistar'));
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

  /** Observaciones con autor — "Administrar la Ruta" (guard en el resolver). */
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

  /** Registra la pre-entrevista ("Registrar pre-entrevistas"; los líderes de ministerio la tienen). */
  async start(me: AuthenticatedUser, raw: unknown): Promise<MembershipJourneyModel> {
    const data = startJourneySchema.parse(raw);
    await this.permissions.assert(
      me,
      'ruta.iniciar',
      undefined,
      'No tienes permiso para registrar pre-entrevistas.',
    );

    const user = await this.prisma.user.findFirst({ where: { id: data.userId } });
    if (!user) throw new NotFoundException(`User ${data.userId} not found.`);
    if (user.baseRole === 'MIEMBRO') {
      throw new BadRequestException('Esta persona ya es miembro.');
    }

    // El expediente lo maneja quien acompaña la Ruta: el entrevistador debe poder.
    if (data.interviewerId && data.interviewerId !== me.sub) {
      const interviewer = await this.prisma.user.findFirst({ where: { id: data.interviewerId } });
      if (!interviewer) throw new NotFoundException(`User ${data.interviewerId} not found.`);
      if (!(await this.permissions.userCan(interviewer, 'ruta.entrevistar'))) {
        throw new BadRequestException(
          'El entrevistador debe ser un líder, un pastor o alguien del equipo de la Ruta.',
        );
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

  /** Agenda (o reprograma) la entrevista inicial. */
  async scheduleInterview(
    me: AuthenticatedUser,
    journeyId: string,
    at: Date,
  ): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    await this.assertInterviewer(me, journey);
    this.assertStage(journey, ['PRE_ENTREVISTA', 'APLAZADO']);
    const row = await this.prisma.membershipJourney.update({
      where: { id: journeyId },
      // Reagendar desde APLAZADO reabre la pre-entrevista.
      data: { preInterviewAt: at, stage: 'PRE_ENTREVISTA' },
      include: JOURNEY_INCLUDE,
    });
    await this.notifyCandidate(row, 'Tu entrevista quedó agendada', formatWhen(at), me.sub);
    return this.withProgress(row, { includeInternal: true });
  }

  /** Aplaza al candidato para una próxima ruta (puede validarse más adelante). */
  async defer(
    me: AuthenticatedUser,
    journeyId: string,
    notes?: string,
  ): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    await this.assertInterviewer(me, journey);
    this.assertStage(journey, ['PRE_ENTREVISTA', 'VALIDADO']);
    const row = await this.prisma.membershipJourney.update({
      where: { id: journeyId },
      data: { stage: 'APLAZADO', notes: notes ?? journey.notes },
      include: JOURNEY_INCLUDE,
    });
    return this.withProgress(row, { includeInternal: true });
  }

  /** Asigna el candidato a un líder de ruta; el líder decide en qué cohorte ubicarlo. */
  async assignToLeader(
    me: AuthenticatedUser,
    journeyId: string,
    leaderId: string,
  ): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    await this.assertInterviewer(me, journey);
    this.assertStage(journey, 'VALIDADO');

    const leader = await this.prisma.user.findFirst({ where: { id: leaderId } });
    if (!leader) throw new NotFoundException(`User ${leaderId} not found.`);
    if (!(await this.permissions.userCan(leader, 'ruta.entrevistar'))) {
      throw new BadRequestException('Solo se puede asignar a un líder de ruta o un pastor.');
    }

    const row = await this.prisma.membershipJourney.update({
      where: { id: journeyId },
      data: { assignedLeaderId: leaderId },
      include: JOURNEY_INCLUDE,
    });
    await this.notifications.notify({
      type: 'ruta.asignacion',
      to: [leaderId],
      title: `Te asignaron a ${fullName(row.user)} en la Ruta`,
      body: 'Pendiente de ubicar en una de tus cohortes.',
      href: '/ruta',
      actorId: me.sub,
      data: { refId: row.id },
    });
    return this.withProgress(row, { includeInternal: true });
  }

  /** Candidatos asignados a mí como líder de ruta, pendientes de cohorte. */
  async myAssignedCandidates(me: AuthenticatedUser): Promise<MembershipJourneyModel[]> {
    const rows = await this.prisma.membershipJourney.findMany({
      where: { assignedLeaderId: me.sub, stage: 'VALIDADO' },
      include: JOURNEY_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    return Promise.all(rows.map((row) => this.withProgress(row, { includeInternal: false })));
  }

  /** El entrevistador (o un pastor) valida la entrada a la Ruta. Exige Evangelio terminado. */
  async validate(
    me: AuthenticatedUser,
    journeyId: string,
    approved: boolean,
    notes?: string,
  ): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    await this.assertInterviewer(me, journey);
    this.assertStage(journey, ['PRE_ENTREVISTA', 'APLAZADO']);

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
    if (approved) {
      await this.notifyCandidate(
        row,
        'Te validaron para la Ruta de Crecimiento',
        'Pronto te ubicarán en una cohorte.',
        me.sub,
      );
    }
    return this.toModel(row, { includeInternal: true });
  }

  /**
   * Ubica al candidato en una cohorte de la Ruta (lo agrega al grupo).
   * Pueden hacerlo el entrevistador, quien administra la Ruta, o el líder
   * asignado hacia una cohorte que él mismo administra.
   */
  async assignToRuta(
    me: AuthenticatedUser,
    journeyId: string,
    groupId: string,
  ): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    this.assertStage(journey, 'VALIDADO');

    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: { course: true },
    });
    if (!group) throw new NotFoundException(`Group ${groupId} not found.`);
    if (group.course?.slug !== RUTA_SLUG || group.archivedAt) {
      throw new BadRequestException('El grupo debe ser una cohorte activa de la Ruta.');
    }

    const isAssignedLeaderPlacing =
      journey.assignedLeaderId === me.sub && (await this.managesGroup(me, group));
    const mayPlace =
      journey.interviewerId === me.sub ||
      isAssignedLeaderPlacing ||
      (await this.permissions.can(me, 'ruta.administrar'));
    if (!mayPlace) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message:
          'Solo el entrevistador, quien administra la Ruta o el líder asignado (hacia su propia cohorte) puede ubicar al candidato.',
      });
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
      // El líder de la cohorte queda como líder asignado del candidato.
      data: { stage: 'EN_RUTA', rutaGroupId: groupId, assignedLeaderId: group.leaderId },
      include: JOURNEY_INCLUDE,
    });
    await this.notifyCandidate(
      row,
      'Empezaste la Ruta de Crecimiento',
      `Tu cohorte: ${group.name}.`,
      me.sub,
    );
    await this.notifications.notify({
      type: 'ruta.asignacion',
      to: [group.leaderId],
      title: `${fullName(row.user)} entró a tu cohorte`,
      body: group.name,
      href: `/grupos/${group.id}`,
      actorId: me.sub,
      data: { refId: row.id },
    });
    return this.toModel(row, { includeInternal: true });
  }

  /** Quien lleva la cohorte (o administra la Ruta) marca la Ruta como terminada. */
  async completeRuta(me: AuthenticatedUser, journeyId: string): Promise<MembershipJourneyModel> {
    const journey = await this.getOrThrow(journeyId);
    this.assertStage(journey, 'EN_RUTA');
    const leadsCohort = !!journey.rutaGroup && (await this.managesGroup(me, journey.rutaGroup));
    if (!leadsCohort && !(await this.permissions.can(me, 'ruta.administrar'))) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message:
          'Solo el líder de la cohorte o quien administra la Ruta puede marcarla como terminada.',
      });
    }

    const row = await this.prisma.membershipJourney.update({
      where: { id: journeyId },
      data: { stage: 'ENTREGA_FINAL', rutaCompletedAt: new Date() },
      include: JOURNEY_INCLUDE,
    });
    await this.notifyCandidate(
      row,
      'Terminaste la Ruta de Crecimiento',
      'Ahora entrega tu ensayo, tu testimonio y una imagen.',
      me.sub,
    );
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
    // El filtro es de los miembros: a ellos (no al candidato) se les pide su observación.
    await this.notifications.notify({
      type: 'muro.anuncio.nuevo',
      to: (await this.notifications.audience(true)).filter((id) => id !== candidate.id),
      title: `Filtro de iglesia: ${fullName(candidate)}`,
      body: 'Quiere hacer pacto de membresía. Si tienes alguna observación, déjala en su perfil.',
      href: `/perfil/${candidate.id}`,
      actorId: me.sub,
      data: { refId: journeyId },
    });
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
    if (passed) {
      await this.notifyCandidate(
        row,
        'Sigue tu entrevista con los pastores',
        pastoralInterviewAt
          ? `Quedó para el ${formatWhen(pastoralInterviewAt)}.`
          : 'Te contactarán para agendarla.',
        null,
      );
    }
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
    await this.notifyCandidate(
      row,
      '¡Ya eres miembro de Alumbra!',
      'Firmaste el pacto de membresía. Gracias por caminar con nosotros.',
      null,
    );
    return this.toModel(row, { includeInternal: true });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Avisa a la persona en proceso de un avance. Los pasos atrás (aplazado, no
   * continúa) no se avisan por la campana: esas noticias las da alguien en persona.
   */
  private notifyCandidate(
    row: JourneyRow,
    title: string,
    body: string,
    actorId: string | null,
  ): Promise<void> {
    return this.notifications.notify({
      type: 'ruta.etapa',
      to: [row.userId],
      title,
      body,
      href: '/ruta',
      actorId,
      data: { refId: row.id, stage: row.stage },
    });
  }

  private async getOrThrow(id: string): Promise<JourneyRow> {
    const journey = await this.prisma.membershipJourney.findUnique({
      where: { id },
      include: JOURNEY_INCLUDE,
    });
    if (!journey) throw new NotFoundException(`Journey ${id} not found.`);
    return journey;
  }

  private assertStage(journey: MembershipJourney, expected: JourneyStage | JourneyStage[]): void {
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(journey.stage)) {
      throw new BadRequestException(
        `El proceso está en etapa ${journey.stage}; esta acción requiere ${allowed.join(' o ')}.`,
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

  private async assertInterviewer(
    me: AuthenticatedUser,
    journey: MembershipJourney,
  ): Promise<void> {
    if (journey.interviewerId === me.sub) return;
    await this.permissions.assert(
      me,
      'ruta.administrar',
      undefined,
      'Solo el entrevistador asignado o quien administra la Ruta puede hacer esto.',
    );
  }

  /** Su líder, o quien tiene "Administrar grupos" sobre el grupo (co-líder). */
  private async managesGroup(
    me: AuthenticatedUser,
    group: Pick<Group, 'id' | 'leaderId'>,
  ): Promise<boolean> {
    if (group.leaderId === me.sub) return true;
    return this.permissions.can(me, 'grupos.administrar', { type: 'GROUP', id: group.id });
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
      assignedLeader: row.assignedLeader ? toUserModel(row.assignedLeader) : null,
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
