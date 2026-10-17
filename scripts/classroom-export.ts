/**
 * Exporta (solo lectura) todo lo de Google Classroom a archivos JSON locales,
 * como primer paso para migrar el Instituto Bíblico a Alumbra.
 *
 * Se corre una vez, en tu máquina. Abre el navegador para que entres con la
 * cuenta dueña (o profesora) de las clases y aceptes permisos de SOLO LECTURA:
 * no modifica nada en Classroom ni en Drive. Los adjuntos de Drive se listan
 * (nombre, tipo, tamaño); con --download además se bajan los que no son video
 * (PDF, Word…) a classroom-export/files/, para copiarlos al bucket.
 *
 * Uso:
 *   pnpm classroom:export
 *   pnpm classroom:export --credentials ./classroom-credentials.json --out ./classroom-export
 *   pnpm classroom:export --download   # también baja los adjuntos (no los videos)
 *   pnpm classroom:export --download --videos   # y los videos (a files/<id>.source,
 *                                                # para comprimirlos antes de subirlos)
 *
 * Necesita un OAuth client de tipo "Aplicación de escritorio" del proyecto
 * alumbra-504117 (ver docs/classroom-migration.md). Ni ese archivo ni la
 * exportación se commitean: tienen datos personales de los alumnos.
 */
import {
  auth as googleAuth,
  classroom as classroomApi,
  type classroom_v1,
} from '@googleapis/classroom';
import { drive as driveApi } from '@googleapis/drive';
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

/** Lo más pesado que se baja; los videos quedan como enlace. */
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

type Page<T> = { items: T[]; nextPageToken?: string | null };

/** Recorre todas las páginas de un listado de la API. */
async function all<T>(fetchPage: (pageToken?: string) => Promise<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  do {
    const page = await fetchPage(token);
    out.push(...page.items);
    token = page.nextPageToken ?? undefined;
  } while (token);
  return out;
}

/**
 * Login de escritorio: abre el navegador, Google vuelve a 127.0.0.1 con el
 * código y se cambia por el token. Nada se guarda en disco.
 */
async function signIn(credentialsPath: string, scopes: string[]) {
  const raw = JSON.parse(await readFile(credentialsPath, 'utf8')) as {
    installed?: { client_id: string; client_secret: string };
  };
  if (!raw.installed) {
    throw new Error(
      'El archivo no es un OAuth client de "Aplicación de escritorio" (falta "installed").',
    );
  }
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = new googleAuth.OAuth2(
    raw.installed.client_id,
    raw.installed.client_secret,
    redirectUri,
  );
  const url = client.generateAuthUrl({ scope: scopes, prompt: 'consent' });

  const code = await new Promise<string>((done, fail) => {
    server.on('request', (req, res) => {
      const params = new URL(req.url ?? '/', redirectUri).searchParams;
      const error = params.get('error');
      const value = params.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        value
          ? '<p>Listo, ya puedes cerrar esta pestaña y volver a la terminal.</p>'
          : `<p>No se pudo entrar: ${error ?? 'sin código'}.</p>`,
      );
      if (value) done(value);
      else if (error) fail(new Error(`Google respondió: ${error}`));
    });
    // El enlace siempre se muestra: si el navegador no se abre solo, se copia.
    console.log(`\nSi no se abre el navegador, abre este enlace:\n${url}\n`);
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execFile(opener, [url], () => undefined);
  });
  server.close();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  return client;
}

/** Un recurso que falla (p. ej. sin permiso) no tumba toda la exportación. */
async function safe<T>(
  label: string,
  errors: string[],
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const message = (e as { message?: string }).message ?? String(e);
    errors.push(`${label}: ${message}`);
    return fallback;
  }
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

/** Los ids de Drive de los materiales de un elemento (tarea, material, anuncio). */
function driveIds(materials: classroom_v1.Schema$Material[] | undefined): string[] {
  return (materials ?? [])
    .map((m) => m.driveFile?.driveFile?.id)
    .filter((id): id is string => Boolean(id));
}

async function main() {
  const { values } = parseArgs({
    options: {
      credentials: { type: 'string', default: './classroom-credentials.json' },
      out: { type: 'string', default: './classroom-export' },
      download: { type: 'boolean', default: false },
      videos: { type: 'boolean', default: false },
    },
  });
  const credentials = resolve(values.credentials!);
  const outDir = resolve(values.out!);
  if (!existsSync(credentials)) {
    console.error(
      `No encuentro ${credentials}.\nDescarga el OAuth client de escritorio (ver docs/classroom-migration.md) y guárdalo ahí.`,
    );
    process.exit(1);
  }

  console.log(
    '==> Abriendo el navegador: entra con la cuenta de Classroom y acepta (solo lectura).',
  );
  // Bajar el contenido pide leer Drive; sin --download basta con la ficha.
  const scopes = values.download
    ? [
        ...SCOPES.filter((s) => !s.endsWith('drive.metadata.readonly')),
        'https://www.googleapis.com/auth/drive.readonly',
      ]
    : SCOPES;
  const auth = await signIn(credentials, scopes);
  const classroom = classroomApi({ version: 'v1', auth });
  const drive = driveApi({ version: 'v3', auth });

  const me = (await classroom.userProfiles.get({ userId: 'me' })).data;
  console.log(`==> Conectado como ${me.name?.fullName} <${me.emailAddress}>`);

  const courses = await all((pageToken) =>
    classroom.courses
      .list({ pageToken, pageSize: 100 })
      .then((r) => ({ items: r.data.courses ?? [], nextPageToken: r.data.nextPageToken })),
  );
  console.log(`==> ${courses.length} clases`);
  await mkdir(outDir, { recursive: true });

  const summary: Array<Record<string, unknown>> = [];
  const allDriveIds = new Set<string>();

  for (const course of courses) {
    const id = course.id!;
    const errors: string[] = [];
    const label = `${course.name}${course.section ? ` (${course.section})` : ''}`;
    process.stdout.write(`    · ${label} … `);

    const [topics, courseWork, materials, announcements, students, teachers] = await Promise.all([
      safe(
        'topics',
        errors,
        () =>
          all((pageToken) =>
            classroom.courses.topics
              .list({ courseId: id, pageToken })
              .then((r) => ({ items: r.data.topic ?? [], nextPageToken: r.data.nextPageToken })),
          ),
        [],
      ),
      safe(
        'courseWork',
        errors,
        () =>
          all((pageToken) =>
            classroom.courses.courseWork
              .list({ courseId: id, pageToken, courseWorkStates: ['PUBLISHED', 'DRAFT'] })
              .then((r) => ({
                items: r.data.courseWork ?? [],
                nextPageToken: r.data.nextPageToken,
              })),
          ),
        [],
      ),
      safe(
        'courseWorkMaterials',
        errors,
        () =>
          all((pageToken) =>
            classroom.courses.courseWorkMaterials
              .list({ courseId: id, pageToken, courseWorkMaterialStates: ['PUBLISHED', 'DRAFT'] })
              .then((r) => ({
                items: r.data.courseWorkMaterial ?? [],
                nextPageToken: r.data.nextPageToken,
              })),
          ),
        [],
      ),
      safe(
        'announcements',
        errors,
        () =>
          all((pageToken) =>
            classroom.courses.announcements.list({ courseId: id, pageToken }).then((r) => ({
              items: r.data.announcements ?? [],
              nextPageToken: r.data.nextPageToken,
            })),
          ),
        [],
      ),
      safe(
        'students',
        errors,
        () =>
          all((pageToken) =>
            classroom.courses.students
              .list({ courseId: id, pageToken })
              .then((r) => ({ items: r.data.students ?? [], nextPageToken: r.data.nextPageToken })),
          ),
        [],
      ),
      safe(
        'teachers',
        errors,
        () =>
          all((pageToken) =>
            classroom.courses.teachers
              .list({ courseId: id, pageToken })
              .then((r) => ({ items: r.data.teachers ?? [], nextPageToken: r.data.nextPageToken })),
          ),
        [],
      ),
    ]);

    // Entregas y notas de todas las tareas de la clase ("-" = todas).
    const submissions = await safe(
      'studentSubmissions',
      errors,
      () =>
        all((pageToken) =>
          classroom.courses.courseWork.studentSubmissions
            .list({ courseId: id, courseWorkId: '-', pageToken })
            .then((r) => ({
              items: r.data.studentSubmissions ?? [],
              nextPageToken: r.data.nextPageToken,
            })),
        ),
      [],
    );

    for (const item of [...courseWork, ...materials, ...announcements]) {
      driveIds(item.materials).forEach((d) => allDriveIds.add(d));
    }
    for (const s of submissions) {
      for (const a of s.assignmentSubmission?.attachments ?? []) {
        if (a.driveFile?.id) allDriveIds.add(a.driveFile.id);
      }
    }

    const dir = join(outDir, `${slugify(course.name ?? id)}-${id}`);
    await mkdir(dir, { recursive: true });
    const files: Record<string, unknown> = {
      'course.json': course,
      'topics.json': topics,
      'coursework.json': courseWork,
      'materials.json': materials,
      'announcements.json': announcements,
      'students.json': students,
      'teachers.json': teachers,
      'submissions.json': submissions,
      'errors.json': errors,
    };
    for (const [name, data] of Object.entries(files)) {
      await writeFile(join(dir, name), JSON.stringify(data, null, 2));
    }

    const row = {
      clase: label,
      estado: course.courseState,
      temas: topics.length,
      tareas: courseWork.length,
      materiales: materials.length,
      anuncios: announcements.length,
      alumnos: students.length,
      profesores: teachers.length,
      entregas: submissions.length,
      errores: errors.length,
    };
    summary.push(row);
    console.log(
      `${row.temas} temas, ${row.tareas} tareas, ${row.materiales} materiales, ${row.alumnos} alumnos${errors.length ? `, ${errors.length} errores` : ''}`,
    );
  }

  // Solo la ficha de cada archivo de Drive: para dimensionar la copia al bucket.
  console.log(`==> Leyendo la ficha de ${allDriveIds.size} archivos de Drive`);
  const driveErrors: string[] = [];
  const driveFiles: unknown[] = [];
  for (const fileId of allDriveIds) {
    const file = await safe(
      `drive ${fileId}`,
      driveErrors,
      () =>
        drive.files
          .get({
            fileId,
            fields: 'id,name,mimeType,size,webViewLink,owners(emailAddress)',
            supportsAllDrives: true,
          })
          .then((r) => r.data),
      null,
    );
    if (file) driveFiles.push(file);
  }
  await writeFile(join(outDir, 'drive-files.json'), JSON.stringify(driveFiles, null, 2));
  await writeFile(join(outDir, 'drive-errors.json'), JSON.stringify(driveErrors, null, 2));

  if (values.download) {
    const filesDir = join(outDir, 'files');
    await mkdir(filesDir, { recursive: true });
    for (const f of driveFiles as Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
    }>) {
      const size = Number(f.size ?? 0);
      const isVideo = f.mimeType.startsWith('video/');
      if (isVideo && values.videos) {
        // Los videos van por streaming (pesan GB) y quedan como .source: se
        // comprimen aparte y el resultado es el que se sube.
        const source = join(filesDir, `${f.id}.source`);
        if (existsSync(source) || existsSync(join(filesDir, f.id))) continue;
        await safe(
          `descargar ${f.name}`,
          driveErrors,
          async () => {
            const res = await drive.files.get(
              { fileId: f.id, alt: 'media', supportsAllDrives: true },
              { responseType: 'stream' },
            );
            await pipeline(res.data as NodeJS.ReadableStream, createWriteStream(`${source}.part`));
            await rename(`${source}.part`, source);
            console.log(`    · bajado: ${f.name} (${(size / 1024 / 1024).toFixed(0)} MB)`);
          },
          undefined,
        );
        continue;
      }
      if (isVideo || size > MAX_DOWNLOAD_BYTES) {
        console.log(`    · se deja como enlace: ${f.name}`);
        continue;
      }
      const target = join(filesDir, f.id);
      if (existsSync(target)) continue;
      await safe(
        `descargar ${f.name}`,
        driveErrors,
        async () => {
          const res = await drive.files.get(
            { fileId: f.id, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' },
          );
          await writeFile(target, Buffer.from(res.data as ArrayBuffer));
          console.log(`    · bajado: ${f.name}`);
        },
        undefined,
      );
    }
    await writeFile(join(outDir, 'drive-errors.json'), JSON.stringify(driveErrors, null, 2));
  }

  const totalBytes = driveFiles.reduce<number>(
    (sum, f) => sum + Number((f as { size?: string }).size ?? 0),
    0,
  );
  await writeFile(
    join(outDir, 'summary.json'),
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        account: me.emailAddress,
        courses: summary,
        driveFiles: driveFiles.length,
        driveErrors: driveErrors.length,
        driveBytes: totalBytes,
      },
      null,
      2,
    ),
  );

  console.log();
  console.table(summary);
  console.log(
    `Drive: ${driveFiles.length} archivos (${(totalBytes / 1024 / 1024).toFixed(1)} MB)${driveErrors.length ? `, ${driveErrors.length} sin acceso` : ''}`,
  );
  console.log(`==> Listo. Todo quedó en ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
