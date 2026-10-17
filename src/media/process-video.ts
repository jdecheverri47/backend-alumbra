import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { UploadStorage } from '../uploads/upload-storage';
import { CONTENT_TYPES, convertToHls } from './hls';

/** Videos subidos que vale la pena pasar a HLS (las listas .m3u8 ya lo son). */
export const VIDEO_NAME = /^[0-9a-f-]{36}\.(mp4|mov|webm)$/;

/**
 * Pasa a HLS un video subido y lo cambia donde se use (adjuntos del instituto
 * y videos del muro). El original se deja: si algo falla, sigue sirviendo.
 */
export async function processVideo(
  name: string,
  deps: { storage: UploadStorage; prisma: PrismaClient },
): Promise<string> {
  if (!VIDEO_NAME.test(name)) throw new Error(`"${name}" no es un video subido.`);
  const log = new Logger('Video');
  const work = await mkdtemp(join(tmpdir(), 'video-'));
  try {
    const input = join(work, `input${extname(name)}`);
    await deps.storage.download(name, input);
    const out = join(work, 'out');
    await mkdir(out);
    const started = Date.now();
    const result = await convertToHls(input, out);
    for (const file of result.files) {
      await deps.storage.uploadFile(
        join(out, file),
        file,
        CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      );
    }

    const from = `/uploads/${name}`;
    const to = `/uploads/${result.playlist}`;
    const [attachments, posts] = await Promise.all([
      deps.prisma.instituteAttachment.updateMany({
        where: { url: from },
        data: { url: to, mimeType: CONTENT_TYPES['.m3u8'] },
      }),
      deps.prisma.postImage.updateMany({ where: { url: from }, data: { url: to } }),
    ]);
    log.log(
      `${name} → ${result.playlist} (${result.transcoded ? 'comprimido' : 'reacomodado'} en ${Math.round((Date.now() - started) / 1000)} s; ${attachments.count + posts.count} uso(s))`,
    );
    return to;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
