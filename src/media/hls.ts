import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
};

export interface HlsOutput {
  /** Nombre de la lista (.m3u8); la portada se llama igual pero .jpg. */
  playlist: string;
  /** Todos los archivos generados en `outDir`. */
  files: string[];
  /** true si se recomprimió (no era H.264/AAC). */
  transcoded: boolean;
}

async function probe(input: string) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name:format=duration',
    '-of',
    'json',
    input,
  ]);
  const data = JSON.parse(stdout) as {
    streams: Array<{ codec_type: string; codec_name: string }>;
    format: { duration?: string };
  };
  return {
    video: data.streams.find((s) => s.codec_type === 'video')?.codec_name,
    audio: data.streams.find((s) => s.codec_type === 'audio')?.codec_name,
    duration: Number(data.format.duration ?? 0),
  };
}

/**
 * Prepara un video para streaming HLS: un solo archivo de video y una lista
 * (.m3u8) que lo pide por rangos de bytes, así arranca en un segundo y se
 * puede adelantar sin bajarlo entero. Si ya es H.264/AAC solo se reacomoda
 * (segundos, sin perder calidad); si no, se comprime a 720p. Saca además una
 * portada (.jpg con el nombre de la lista).
 */
export async function convertToHls(input: string, outDir: string): Promise<HlsOutput> {
  const info = await probe(input);
  if (!info.video) throw new Error('El archivo no tiene video.');
  const copy = info.video === 'h264' && (!info.audio || info.audio === 'aac');
  const playlist = `${randomUUID()}.m3u8`;
  const media = `${randomUUID()}.mp4`;

  await run(
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
            'scale=-2:min(720\\,ih)',
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
      join(outDir, media),
      join(outDir, playlist),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );

  // Portada: un cuadro al 10 % (el principio suele ser negro o un título).
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(Math.max(0, Math.round(info.duration * 0.1))),
    '-i',
    input,
    '-frames:v',
    '1',
    '-vf',
    'scale=-2:min(720\\,ih)',
    '-q:v',
    '4',
    join(outDir, playlist.replace(/\.m3u8$/, '.jpg')),
  ]).catch(() => undefined); // sin portada también sirve

  return { playlist, files: await readdir(outDir), transcoded: !copy };
}
