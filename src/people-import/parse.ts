import { BaseRole, MinistryRole } from '@prisma/client';

/** Minúsculas, sin tildes ni espacios de más: para comparar lo que escribe la gente. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "Miembro" / "asistente" (con o sin tilde, mayúsculas, plural). */
export function parseType(raw: string | null | undefined): BaseRole | null {
  const t = normalize(raw ?? '');
  if (/^miembros?$/.test(t)) return 'MIEMBRO';
  if (/^asistentes?$/.test(t)) return 'ASISTENTE';
  return null;
}

/**
 * Fechas como las escriben en Colombia: dd/mm/aaaa (o con guiones o puntos), o
 * aaaa-mm-dd (ISO, como las exporta Sheets). Devuelve mediodía UTC para que no
 * cambie de día con la zona horaria. Lanza si la fecha no existe.
 */
export function parseDate(raw: string | null | undefined): Date | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  let year: number;
  let month: number;
  let day: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (m) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
    if (!m) throw new Error(`"${text}" no es una fecha (usa dd/mm/aaaa)`);
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (year < 100) year += year > new Date().getFullYear() % 100 ? 1900 : 2000;
  }
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    year < 1900 ||
    date.getTime() > Date.now() + 86_400_000
  ) {
    throw new Error(`"${text}" no es una fecha válida`);
  }
  return date;
}

export interface MinistryLookup {
  id: string;
  slug: string;
  name: string;
}

/**
 * "Alabanza, Multimedia (coordinador)" → [{Alabanza, MEMBER}, {Multimedia, LEADER}].
 * Acepta el nombre o el slug, y también una parte inequívoca ("alcance").
 */
export function parseMinistries(
  raw: string | null | undefined,
  ministries: MinistryLookup[],
): Array<{ ministry: MinistryLookup; role: MinistryRole }> {
  const text = (raw ?? '').trim();
  if (!text) return [];
  const result: Array<{ ministry: MinistryLookup; role: MinistryRole }> = [];
  for (const part of text.split(/[,;\n]/)) {
    let item = normalize(part);
    if (!item) continue;
    let role: MinistryRole = 'MEMBER';
    const leader = /\(?\b(coordinador|coordinadora|lider)\b\)?/;
    if (leader.test(item)) {
      role = 'LEADER';
      item = item.replace(leader, '').replace(/[()]/g, '').trim();
    }
    const exact = ministries.find((m) => normalize(m.name) === item || m.slug === item);
    const partial = ministries.filter((m) => normalize(m.name).includes(item));
    const ministry = exact ?? (partial.length === 1 ? partial[0] : undefined);
    if (!ministry) throw new Error(`no hay un ministerio llamado "${part.trim()}"`);
    if (!result.some((r) => r.ministry.id === ministry.id)) result.push({ ministry, role });
  }
  return result;
}
