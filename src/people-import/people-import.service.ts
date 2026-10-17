import { BadRequestException, Injectable } from '@nestjs/common';
import { BaseRole, MinistryRole, Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import {
  ImportAction,
  ImportPeopleResult,
  ImportPersonInput,
  ImportRowResult,
} from './dto/import.types';
import { MinistryLookup, parseDate, parseMinistries, parseType } from './parse';

const MAX_ROWS = 2000;
const ROLE_NAME: Record<MinistryRole, string> = { LEADER: 'coordinador', MEMBER: 'ministro' };

const emailSchema = z.string().email();

interface Plan {
  result: ImportRowResult;
  /** Lo que hay que escribir; null si es error o no cambia nada. */
  write: null | {
    userId: string | null;
    data: Prisma.UserUncheckedCreateInput | Prisma.UserUncheckedUpdateInput;
    memberships: Array<{ ministryId: string; role: MinistryRole }>;
  };
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Carga de personas desde una hoja de cálculo. Primero se pide sin aplicar
 * (vista previa con lo que haría cada fila) y luego se aplica. Es seguro
 * repetirla: si el correo ya existe, solo completa lo que falta, sube de
 * asistente a miembro (nunca al revés) y suma ministerios.
 */
@Injectable()
export class PeopleImportService {
  constructor(private readonly prisma: PrismaService) {}

  async run(
    rows: ImportPersonInput[],
    apply: boolean,
    { canAssignMinistries = true }: { canAssignMinistries?: boolean } = {},
  ): Promise<ImportPeopleResult> {
    if (rows.length === 0) throw new BadRequestException('La hoja no tiene filas.');
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(`Se pueden importar hasta ${MAX_ROWS} filas a la vez.`);
    }

    const ministries: MinistryLookup[] = await this.prisma.ministry.findMany({
      where: { archivedAt: null },
      select: { id: true, slug: true, name: true },
    });
    const emails = rows.map((r) => clean(r.email).toLowerCase()).filter(Boolean);
    const existing = await this.prisma.user.findMany({
      where: { email: { in: emails, mode: 'insensitive' } },
      include: { ministryMemberships: { where: { leftAt: null } } },
    });
    const byEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u]));
    const seen = new Map<string, number>();

    const plans = rows.map((row, i) =>
      this.plan(row, i + 1, ministries, byEmail, seen, canAssignMinistries),
    );

    if (apply) {
      for (const plan of plans) {
        if (!plan.write) continue;
        try {
          await this.write(plan.write);
        } catch (e) {
          plan.result.action = ImportAction.ERROR;
          plan.result.messages = [
            e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
              ? 'Ese correo ya está registrado.'
              : 'No se pudo guardar esta fila.',
          ];
        }
      }
    }

    const results = plans.map((p) => p.result);
    const count = (a: ImportAction) => results.filter((r) => r.action === a).length;
    return {
      rows: results,
      created: count(ImportAction.CREATE),
      updated: count(ImportAction.UPDATE),
      unchanged: count(ImportAction.UNCHANGED),
      errors: count(ImportAction.ERROR),
      applied: apply,
    };
  }

  private plan(
    row: ImportPersonInput,
    index: number,
    ministries: MinistryLookup[],
    byEmail: Map<
      string,
      User & { ministryMemberships: Array<{ ministryId: string; role: MinistryRole }> }
    >,
    seen: Map<string, number>,
    canAssignMinistries: boolean,
  ): Plan {
    const firstName = clean(row.firstName);
    const lastName = clean(row.lastName);
    const email = clean(row.email).toLowerCase();
    const phone = clean(row.phone) || null;
    const result: ImportRowResult = {
      index,
      action: ImportAction.ERROR,
      email: email || null,
      fullName: `${firstName} ${lastName}`.trim() || '(sin nombre)',
      baseRole: null,
      ministries: [],
      messages: [],
    };
    const errors = result.messages;

    if (!firstName) errors.push('Falta el nombre.');
    if (!lastName) errors.push('Falta el apellido.');
    if (!email) errors.push('Falta el correo.');
    else if (!emailSchema.safeParse(email).success)
      errors.push(`"${email}" no es un correo válido.`);
    else if (seen.has(email)) errors.push(`El correo ya aparece en la fila ${seen.get(email)}.`);
    if (email) seen.set(email, seen.get(email) ?? index);

    const type = parseType(row.type);
    if (!type) errors.push('El tipo tiene que ser "Miembro" o "Asistente".');
    result.baseRole = type;

    const dates: Record<'membershipDate' | 'baptismDate' | 'birthDate', Date | null> = {
      membershipDate: null,
      baptismDate: null,
      birthDate: null,
    };
    const DATE_LABEL = {
      membershipDate: 'fecha de membresía',
      baptismDate: 'fecha de bautismo',
      birthDate: 'fecha de nacimiento',
    };
    for (const key of Object.keys(dates) as Array<keyof typeof dates>) {
      try {
        dates[key] = parseDate(row[key]);
      } catch (e) {
        errors.push(`La ${DATE_LABEL[key]}: ${(e as Error).message}.`);
      }
    }

    let wanted: Array<{ ministry: MinistryLookup; role: MinistryRole }> = [];
    try {
      wanted = parseMinistries(row.ministries, ministries);
    } catch (e) {
      errors.push(`Ministerios: ${(e as Error).message}.`);
    }
    if (wanted.length > 0 && !canAssignMinistries) {
      errors.push('No tienes permiso para asignar ministerios (pídeselo a un pastor).');
    }

    const current = email ? byEmail.get(email) : undefined;
    if (current?.deletedAt) errors.push('Ese correo pertenece a una persona eliminada.');

    // Al final cuenta el tipo real: un miembro que ya existe sigue siéndolo.
    const finalRole: BaseRole | null = current && current.baseRole === 'MIEMBRO' ? 'MIEMBRO' : type;
    if (wanted.length > 0 && finalRole === 'ASISTENTE' && !current?.isPastor) {
      errors.push('Solo los miembros sirven en ministerios.');
    }
    result.ministries = wanted.map((w) => `${w.ministry.name} (${ROLE_NAME[w.role]})`);

    if (errors.length > 0) return { result, write: null };

    if (!current) {
      result.action = ImportAction.CREATE;
      return {
        result,
        write: {
          userId: null,
          data: {
            email,
            firstName,
            lastName,
            phone,
            baseRole: type!,
            canSignIn: true,
            ...dates,
          },
          memberships: wanted.map((w) => ({ ministryId: w.ministry.id, role: w.role })),
        },
      };
    }

    // Ya existe: solo completa. Nada de lo que hay se borra ni se pisa.
    const data: Prisma.UserUncheckedUpdateInput = {};
    const notes = result.messages;
    if (type === 'MIEMBRO' && current.baseRole === 'ASISTENTE') {
      data.baseRole = 'MIEMBRO';
      notes.push('Pasa de asistente a miembro.');
    }
    if (type === 'ASISTENTE' && current.baseRole === 'MIEMBRO') {
      notes.push('Ya es miembro: se deja como miembro.');
    }
    if (!current.canSignIn) {
      data.canSignIn = true;
      notes.push('Se le habilita la entrada.');
    }
    if (phone && !current.phone) data.phone = phone;
    for (const key of Object.keys(dates) as Array<keyof typeof dates>) {
      if (dates[key] && !current[key]) data[key] = dates[key];
    }
    const filled = ['phone', ...Object.keys(dates)].filter((k) => k in data);
    if (filled.length > 0) notes.push('Completa datos que faltaban.');

    const have = new Map(current.ministryMemberships.map((m) => [m.ministryId, m.role]));
    const memberships = wanted
      .filter((w) => !have.has(w.ministry.id))
      .map((w) => ({ ministryId: w.ministry.id, role: w.role }));
    for (const w of wanted) {
      const role = have.get(w.ministry.id);
      if (role && role !== w.role) {
        notes.push(`Ya está en ${w.ministry.name} como ${ROLE_NAME[role]}; no se cambia.`);
      }
    }
    if (memberships.length > 0) notes.push(`Se suma a ${memberships.length} ministerio(s).`);

    const changes = Object.keys(data).length > 0 || memberships.length > 0;
    result.action = changes ? ImportAction.UPDATE : ImportAction.UNCHANGED;
    if (!changes && notes.length === 0) notes.push('Ya estaba registrada y al día.');
    return { result, write: changes ? { userId: current.id, data, memberships } : null };
  }

  private async write(write: NonNullable<Plan['write']>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = write.userId
        ? await tx.user.update({
            where: { id: write.userId },
            data: write.data as Prisma.UserUncheckedUpdateInput,
          })
        : await tx.user.create({ data: write.data as Prisma.UserUncheckedCreateInput });
      if (write.memberships.length > 0) {
        await tx.ministryMembership.createMany({
          data: write.memberships.map((m) => ({ ...m, userId: user.id })),
        });
      }
    });
  }
}
