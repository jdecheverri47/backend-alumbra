/**
 * Prepara a mano un video para streaming HLS (lo mismo que hace solo el
 * trabajo `video-hls` con lo que se publica; ver src/media/hls.ts). Útil para
 * videos que no se subieron por la app, como los que vinieron de Classroom.
 *
 *   pnpm video:hls clase.mp4                       # local (./uploads)
 *   pnpm video:hls clase.mp4 --files gcs           # al bucket
 *   pnpm video:hls clase.mp4 --files gcs --replace /uploads/viejo.mp4
 *       # y cambia ese video por el nuevo donde se use (instituto y muro)
 */
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CONTENT_TYPES, convertToHls } from '../src/media/hls';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      files: { type: 'string', default: 'disk' },
      bucket: { type: 'string', default: 'alumbra-504117-uploads' },
      replace: { type: 'string' },
    },
  });
  const input = positionals[0] && resolve(positionals[0]);
  if (!input || !existsSync(input)) {
    console.error('Uso: pnpm video:hls <video> [--files gcs] [--replace /uploads/viejo.mp4]');
    process.exit(1);
  }

  const work = mkdtempSync(join(tmpdir(), 'hls-'));
  try {
    console.log(`==> Preparando ${input}`);
    const result = await convertToHls(input, work);
    for (const file of result.files) {
      const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
      if (values.files === 'gcs') {
        execFileSync(
          'gcloud',
          [
            'storage',
            'cp',
            join(work, file),
            `gs://${values.bucket}/${file}`,
            `--content-type=${type}`,
            '--quiet',
          ],
          { stdio: 'inherit' },
        );
      } else {
        const dir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
        mkdirSync(dir, { recursive: true });
        copyFileSync(join(work, file), join(dir, file));
      }
    }
    const url = `/uploads/${result.playlist}`;
    console.log(`==> Listo (${result.transcoded ? 'comprimido a 720p' : 'reacomodado'}): ${url}`);

    if (values.replace) {
      const prisma = new PrismaClient();
      const [attachments, posts] = await Promise.all([
        prisma.instituteAttachment.updateMany({
          where: { url: values.replace },
          data: { url, mimeType: CONTENT_TYPES['.m3u8'] },
        }),
        prisma.postImage.updateMany({ where: { url: values.replace }, data: { url } }),
      ]);
      console.log(
        `==> ${values.replace} reemplazado en ${attachments.count} adjunto(s) del instituto y ${posts.count} publicación(es) del muro.`,
      );
      await prisma.$disconnect();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
