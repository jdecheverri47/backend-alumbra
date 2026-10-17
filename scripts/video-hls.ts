/**
 * Prepara un video para verse por streaming (HLS): arranca en un segundo y se
 * puede adelantar sin bajar el archivo entero.
 *
 * El video queda en UN solo archivo y una lista (.m3u8) que lo pide por rangos
 * de bytes; el backend firma ese archivo al servir la lista (ver
 * UploadsController.playlist). También saca una portada (.jpg con el mismo
 * nombre de la lista), que el reproductor usa sola.
 *
 * Si el video ya es H.264/AAC solo se reacomoda (segundos, sin perder
 * calidad); si no, se comprime a 720p.
 *
 *   pnpm video:hls clase.mp4                       # local (./uploads)
 *   pnpm video:hls clase.mp4 --files gcs           # al bucket
 *   pnpm video:hls clase.mp4 --files gcs --replace /uploads/viejo.mp4
 *       # y cambia ese video por el nuevo donde se use (instituto y muro)
 */
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

function probe(input: string): { video?: string; audio?: string; duration: number } {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name:format=duration',
    '-of',
    'json',
    input,
  ]).toString();
  const data = JSON.parse(out) as {
    streams: Array<{ codec_type: string; codec_name: string }>;
    format: { duration: string };
  };
  return {
    video: data.streams.find((s) => s.codec_type === 'video')?.codec_name,
    audio: data.streams.find((s) => s.codec_type === 'audio')?.codec_name,
    duration: Number(data.format.duration),
  };
}

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

  const info = probe(input);
  const copy = info.video === 'h264' && (!info.audio || info.audio === 'aac');
  const playlist = `${randomUUID()}.m3u8`;
  const media = `${randomUUID()}.mp4`;
  const poster = playlist.replace(/\.m3u8$/, '.jpg');
  const work = mkdtempSync(join(tmpdir(), 'hls-'));

  console.log(`==> ${copy ? 'Reacomodando (sin recomprimir)' : 'Comprimiendo a 720p'}: ${input}`);
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      ...(copy
        ? ['-c', 'copy']
        : [
            '-vf',
            'scale=-2:720',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '26',
            '-maxrate',
            '1800k',
            '-bufsize',
            '3600k',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '96k',
          ]),
      '-f',
      'hls',
      '-hls_time',
      '6',
      '-hls_playlist_type',
      'vod',
      '-hls_segment_type',
      'fmp4',
      // Todo en un archivo: la lista lo pide por rangos de bytes.
      '-hls_flags',
      'single_file',
      '-hls_segment_filename',
      join(work, media),
      join(work, playlist),
    ],
    { stdio: 'inherit' },
  );
  // Portada: un cuadro al 10 % (el principio suele ser negro o un título).
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(Math.max(1, Math.round(info.duration * 0.1))),
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    'scale=-2:720',
    '-q:v',
    '4',
    join(work, poster),
  ]);

  const files = readdirSync(work);
  const types: Record<string, string> = {
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.mp4': 'video/mp4',
    '.jpg': 'image/jpeg',
  };
  for (const file of files) {
    const type = types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream';
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
  rmSync(work, { recursive: true, force: true });

  const url = `/uploads/${playlist}`;
  console.log(`==> Listo: ${url} (portada /uploads/${poster})`);

  if (values.replace) {
    const prisma = new PrismaClient();
    const [attachments, posts] = await Promise.all([
      prisma.instituteAttachment.updateMany({
        where: { url: values.replace },
        data: { url, mimeType: types['.m3u8'] },
      }),
      prisma.postImage.updateMany({ where: { url: values.replace }, data: { url } }),
    ]);
    console.log(
      `==> ${values.replace} reemplazado en ${attachments.count} adjunto(s) del instituto y ${posts.count} publicación(es) del muro.`,
    );
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
