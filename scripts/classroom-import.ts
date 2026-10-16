/**
 * Importa al Instituto Bíblico lo que exportó scripts/classroom-export.ts.
 *
 * Se puede repetir: cada módulo, publicación y entrega guarda su id de
 * Classroom, así que la segunda vez actualiza en lugar de duplicar. Sin
 * --apply solo muestra lo que haría.
 *
 *   pnpm classroom:import                       # vista previa
 *   pnpm classroom:import --apply               # local: archivos a ./uploads
 *   DATABASE_URL=… pnpm classroom:import --apply --files gcs   # producción
 *   pnpm classroom:import --exclude it@x.co,admin@x.co           # sin esas cuentas
 *
 * - Alumnos y profesores se buscan por correo; quien no tenga cuenta se crea
 *   como asistente, con acceso para entrar con Google. A nadie existente se le
 *   cambia el tipo.
 * - Los adjuntos de Drive bajados (classroom-export/files) se suben a /uploads
 *   (disco o bucket); los videos quedan como enlace a Drive.
 * - Los exámenes de Google Forms quedan como enlace al formulario.
 */
import {
  InstituteAttachmentKind,
  InstituteItemKind,
  InstituteSubmissionState,
  PrismaClient,
} from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// --- Formas de lo exportado (solo lo que se usa) ----------------------------

interface Profile {
  id: string;
  emailAddress?: string;
  name?: { givenName?: string; familyName?: string; fullName?: string };
}
interface Material {
  driveFile?: { driveFile?: { id: string; title?: string; alternateLink?: string } };
  link?: { url: string; title?: string };
  youtubeVideo?: { id: string; title?: string; alternateLink?: string };
  form?: { formUrl: string; title?: string };
}
interface ClassroomItem {
  id: string;
  title?: string;
  description?: string;
  topicId?: string;
  state?: string;
  creationTime?: string;
  creatorUserId?: string;
  materials?: Material[];
  maxPoints?: number;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
}
interface Submission {
  id: string;
  courseWorkId: string;
  userId: string;
  state?: string;
  late?: boolean;
  assignedGrade?: number;
  draftGrade?: number;
  updateTime?: string;
  submissionHistory?: Array<{
    stateHistory?: { state: string; stateTimestamp: string };
    gradeHistory?: { gradeTimestamp: string; actorUserId?: string; gradeChangeType?: string };
  }>;
}
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

// --- Utilidades ---------------------------------------------------------------

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function splitName(p: Profile): { firstName: string; lastName: string } {
  const first = p.name?.givenName?.trim();
  const last = p.name?.familyName?.trim();
  if (first && last) return { firstName: first, lastName: last };
  const parts = (p.name?.fullName ?? p.emailAddress ?? 'Sin nombre').trim().split(/\s+/);
  return { firstName: first ?? parts[0], lastName: last ?? (parts.slice(1).join(' ') || '-') };
}

function dueAt(item: ClassroomItem): Date | null {
  if (!item.dueDate) return null;
  const { year, month, day } = item.dueDate;
  // Classroom guarda la hora en UTC (23:59 en Colombia = 04:59 UTC del día siguiente).
  return new Date(
    Date.UTC(year, month - 1, day, item.dueTime?.hours ?? 23, item.dueTime?.minutes ?? 59),
  );
}

function youtubeLike(url: string): boolean {
  return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(new URL(url).hostname);
}

function cleanTitle(title: string | undefined, fallback: string): string {
  return (title ?? '').replace(/\s*-\s*YouTube$/, '').trim() || fallback;
}

// --- Principal ----------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', default: './classroom-export' },
      apply: { type: 'boolean', default: false },
      files: { type: 'string', default: 'disk' },
      bucket: { type: 'string', default: 'alumbra-504117-uploads' },
      // Cuentas que no son personas (p. ej. las administrativas de Classroom).
      exclude: { type: 'string', default: '' },
    },
  });
  const dir = resolve(values.dir!);
  const apply = values.apply!;
  const toGcs = values.files === 'gcs';
  const excluded = new Set(
    values
      .exclude!.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  const courseDir = readdirSync(dir).find((d) => existsSync(join(dir, d, 'course.json')));
  if (!courseDir) throw new Error(`No hay una clase exportada en ${dir}.`);
  const at = (name: string) => join(dir, courseDir, name);

  const topics = read<Array<{ topicId: string; name: string }>>(at('topics.json'));
  const coursework = read<ClassroomItem[]>(at('coursework.json'));
  const materials = read<ClassroomItem[]>(at('materials.json'));
  const students = read<Array<{ userId: string; profile: Profile }>>(at('students.json'));
  const teachers = read<Array<{ userId: string; profile: Profile }>>(at('teachers.json'));
  const submissions = read<Submission[]>(at('submissions.json'));
  const driveFiles = new Map(
    read<DriveFile[]>(join(dir, 'drive-files.json')).map((f) => [f.id, f]),
  );
  const filesDir = join(dir, 'files');

  const prisma = new PrismaClient();
  const report = {
    usersNew: [] as string[],
    usersExisting: 0,
    teachersNew: [] as string[],
    enrollments: 0,
    modules: 0,
    items: 0,
    attachments: { FILE: 0, LINK: 0, YOUTUBE: 0, FORM: 0 } as Record<
      InstituteAttachmentKind,
      number
    >,
    submissions: 0,
    grades: 0,
  };

  console.log(`==> ${apply ? 'IMPORTANDO' : 'Vista previa (nada se guarda; usa --apply)'}`);
  console.log(
    `    base de datos: ${(process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@')}`,
  );

  // 1. Personas: por correo; quien no exista, como asistente con acceso.
  const userIdByClassroom = new Map<string, string>();
  const people = [
    ...teachers.map((t) => ({ ...t, role: 'TEACHER' as const })),
    ...students.map((s) => ({ ...s, role: 'STUDENT' as const })),
  ];
  for (const person of people) {
    const email = person.profile.emailAddress?.trim().toLowerCase();
    if (!email || excluded.has(email)) continue;
    let user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (user) {
      report.usersExisting += 1;
      if (apply && !user.canSignIn && !user.deletedAt) {
        user = await prisma.user.update({ where: { id: user.id }, data: { canSignIn: true } });
      }
    } else {
      report.usersNew.push(email);
      if (person.role === 'TEACHER') report.teachersNew.push(email);
      if (apply) {
        user = await prisma.user.create({
          data: { email, ...splitName(person.profile), baseRole: 'ASISTENTE', canSignIn: true },
        });
      }
    }
    if (user) userIdByClassroom.set(person.userId, user.id);

    if (apply && user) {
      const existing = await prisma.instituteEnrollment.findUnique({ where: { userId: user.id } });
      // Un profesor no se baja a alumno.
      const role = existing?.role === 'TEACHER' ? 'TEACHER' : person.role;
      await prisma.instituteEnrollment.upsert({
        where: { userId: user.id },
        create: { userId: user.id, role, classroomId: person.userId },
        update: { role, leftAt: null, classroomId: person.userId },
      });
    }
    report.enrollments += 1;
  }

  // Autor de respaldo: el primer pastor (todo lo creó un profesor, pero por si acaso).
  const fallbackAuthor = await prisma.user.findFirst({
    where: { isPastor: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!fallbackAuthor) throw new Error('No hay ningún pastor para usar como autor de respaldo.');

  // 2. Módulos: la presentación primero; los demás en el orden en que arrancaron.
  const all = [
    ...materials.map((m) => ({ ...m, isWork: false })),
    ...coursework.map((c) => ({ ...c, isWork: true })),
  ];
  const firstAt = (topicId: string) =>
    Math.min(
      ...all
        .filter((i) => i.topicId === topicId)
        .map((i) => Date.parse(i.creationTime ?? '') || Infinity),
    );
  const orderedTopics = [...topics].sort((a, b) => {
    const intro = (t: { name: string }) => (/presentaci/i.test(t.name) ? 0 : 1);
    return intro(a) - intro(b) || firstAt(a.topicId) - firstAt(b.topicId);
  });
  const moduleIdByTopic = new Map<string, string>();
  for (const [order, topic] of orderedTopics.entries()) {
    // "1. ¿Por qué…?" → "¿Por qué…?": el orden ya lo da el módulo.
    const title = topic.name.replace(/^\d+\.\s*/, '').trim();
    report.modules += 1;
    if (!apply) continue;
    const m = await prisma.instituteModule.upsert({
      where: { classroomId: topic.topicId },
      create: { classroomId: topic.topicId, order, title },
      update: { order, title },
    });
    moduleIdByTopic.set(topic.topicId, m.id);
  }

  // 3. Archivos: cada adjunto bajado se sube una sola vez (se recuerda en un mapa).
  const uploadedPath = join(dir, `uploaded-${toGcs ? 'gcs' : 'disk'}.json`);
  const uploaded: Record<string, string> = existsSync(uploadedPath) ? read(uploadedPath) : {};
  const uploadDir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
  function upload(file: DriveFile): string {
    if (uploaded[file.id]) return uploaded[file.id];
    const source = join(filesDir, file.id);
    const ext = (extname(file.name)
      .toLowerCase()
      .match(/^\.[a-z0-9]{1,10}$/) ?? ['.bin'])[0];
    const name = `${randomUUID()}${ext}`;
    if (toGcs) {
      execFileSync(
        'gcloud',
        [
          'storage',
          'cp',
          source,
          `gs://${values.bucket}/${name}`,
          `--content-type=${file.mimeType}`,
          '--quiet',
        ],
        { stdio: 'inherit' },
      );
    } else {
      mkdirSync(uploadDir, { recursive: true });
      copyFileSync(source, join(uploadDir, name));
    }
    uploaded[file.id] = `/uploads/${name}`;
    writeFileSync(uploadedPath, JSON.stringify(uploaded, null, 2));
    return uploaded[file.id];
  }

  function attachmentsOf(item: ClassroomItem) {
    const out: Array<{
      kind: InstituteAttachmentKind;
      title: string;
      url: string;
      mimeType?: string;
    }> = [];
    for (const m of item.materials ?? []) {
      if (m.driveFile?.driveFile) {
        const ref = m.driveFile.driveFile;
        const file = driveFiles.get(ref.id);
        const downloaded = existsSync(join(filesDir, ref.id));
        if (file && downloaded) {
          out.push({
            kind: 'FILE',
            title: file.name,
            url: apply ? upload(file) : '(archivo)',
            mimeType: file.mimeType,
          });
        } else {
          // Videos grandes: quedan en Drive.
          out.push({
            kind: 'LINK',
            title: ref.title ?? file?.name ?? 'Archivo en Drive',
            url: ref.alternateLink ?? `https://drive.google.com/file/d/${ref.id}/view`,
          });
        }
      } else if (m.youtubeVideo) {
        out.push({
          kind: 'YOUTUBE',
          title: cleanTitle(m.youtubeVideo.title, 'Video'),
          url: m.youtubeVideo.alternateLink ?? `https://youtu.be/${m.youtubeVideo.id}`,
        });
      } else if (m.link) {
        out.push({
          kind: youtubeLike(m.link.url) ? 'YOUTUBE' : 'LINK',
          title: cleanTitle(m.link.title, m.link.url),
          url: m.link.url,
        });
      } else if (m.form) {
        // El enlace de Classroom es el de edición; los alumnos necesitan el de responder.
        out.push({
          kind: 'FORM',
          title: m.form.title ?? 'Formulario',
          url: m.form.formUrl.replace(/\/edit(\?.*)?$/, '/viewform'),
        });
      }
    }
    return out;
  }

  // 4. Publicaciones.
  const itemIdByClassroom = new Map<string, string>();
  for (const item of all) {
    const isExam =
      item.isWork &&
      ((item.materials ?? []).some((m) => m.form) || /examen/i.test(item.title ?? ''));
    const kind: InstituteItemKind = !item.isWork ? 'MATERIAL' : isExam ? 'EXAM' : 'ASSIGNMENT';
    const attachments = attachmentsOf(item);
    report.items += 1;
    attachments.forEach((a) => (report.attachments[a.kind] += 1));
    if (!apply) continue;
    const moduleId = item.topicId ? moduleIdByTopic.get(item.topicId) : undefined;
    if (!moduleId) {
      console.warn(`    ! "${item.title}" no tiene módulo; se omite.`);
      continue;
    }
    const data = {
      moduleId,
      kind,
      title: (item.title ?? 'Sin título').trim(),
      description: item.description?.trim() || null,
      maxPoints: kind === 'MATERIAL' || item.maxPoints == null ? null : Math.round(item.maxPoints),
      dueAt: kind === 'MATERIAL' ? null : dueAt(item),
      publishAt:
        item.state === 'PUBLISHED' && item.creationTime ? new Date(item.creationTime) : null,
      authorId:
        (item.creatorUserId && userIdByClassroom.get(item.creatorUserId)) || fallbackAuthor.id,
    };
    const saved = await prisma.$transaction(async (tx) => {
      const row = await tx.instituteItem.upsert({
        where: { classroomId: item.id },
        create: {
          ...data,
          classroomId: item.id,
          createdAt: item.creationTime ? new Date(item.creationTime) : undefined,
        },
        update: data,
      });
      await tx.instituteAttachment.deleteMany({ where: { itemId: row.id } });
      await tx.instituteAttachment.createMany({
        data: attachments.map((a, position) => ({ ...a, itemId: row.id, position })),
      });
      return row;
    });
    itemIdByClassroom.set(item.id, saved.id);
  }

  // 5. Entregas y notas: solo las que tienen algo (entregada o con nota).
  for (const s of submissions) {
    const state: InstituteSubmissionState | null =
      s.state === 'TURNED_IN' || s.state === 'RETURNED' ? s.state : null;
    if (!state && s.assignedGrade == null && s.draftGrade == null) continue;
    report.submissions += 1;
    if (s.assignedGrade != null) report.grades += 1;
    if (!apply) continue;
    const itemId = itemIdByClassroom.get(s.courseWorkId);
    const studentId = userIdByClassroom.get(s.userId);
    if (!itemId || !studentId) continue;
    const history = s.submissionHistory ?? [];
    const turnedIn = history
      .map((h) => h.stateHistory)
      .filter((h) => h?.state === 'TURNED_IN')
      .pop();
    const graded = history
      .map((h) => h.gradeHistory)
      .filter((h) => h?.gradeChangeType === 'ASSIGNED_GRADE_POINTS_EARNED_CHANGE')
      .pop();
    const data = {
      state,
      turnedInAt: turnedIn ? new Date(turnedIn.stateTimestamp) : null,
      late: Boolean(s.late),
      grade: s.assignedGrade ?? null,
      // Si ya se devolvió, el borrador sobra (Classroom lo deja igual a la nota).
      draftGrade: s.assignedGrade == null ? (s.draftGrade ?? null) : null,
      gradedAt: graded ? new Date(graded.gradeTimestamp) : null,
      gradedById: (graded?.actorUserId && userIdByClassroom.get(graded.actorUserId)) || null,
    };
    await prisma.instituteSubmission.upsert({
      where: { itemId_studentId: { itemId, studentId } },
      create: { ...data, itemId, studentId, classroomId: s.id },
      update: { ...data, classroomId: s.id },
    });
  }

  console.log();
  console.table({
    'personas nuevas': report.usersNew.length,
    'personas que ya existían': report.usersExisting,
    inscripciones: report.enrollments,
    módulos: report.modules,
    publicaciones: report.items,
    'archivos (al bucket)': report.attachments.FILE,
    'enlaces (Drive y web)': report.attachments.LINK,
    'videos de YouTube': report.attachments.YOUTUBE,
    'formularios (exámenes)': report.attachments.FORM,
    'entregas con algo': report.submissions,
    'notas devueltas': report.grades,
  });
  if (report.teachersNew.length) {
    console.log('Profesores sin cuenta (se crean como asistentes; revisa si deben ser miembros):');
    report.teachersNew.forEach((e) => console.log(`  - ${e}`));
  }
  console.log(apply ? '==> Importación terminada.' : '==> Vista previa. Para guardar: --apply');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
