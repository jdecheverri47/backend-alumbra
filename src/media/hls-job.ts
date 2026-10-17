/**
 * Trabajo de Cloud Run `video-hls`: pasa a HLS un video subido y lo cambia
 * donde se use. Lo lanza VideoProcessingService con el nombre del archivo:
 *
 *   node dist/media/hls-job.js <uuid>.mp4
 *
 * Usa la misma imagen que la API (que trae ffmpeg) y las mismas variables
 * (DATABASE_URL, GCS_BUCKET).
 */
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DiskUploadStorage, GcsUploadStorage } from '../uploads/upload-storage';
import { processVideo } from './process-video';

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('Falta el nombre del video.');
  const bucket = process.env.GCS_BUCKET;
  const storage = bucket
    ? new GcsUploadStorage(bucket)
    : new DiskUploadStorage(process.env.JWT_SECRET ?? 'local');
  const prisma = new PrismaClient();
  try {
    await processVideo(name, { storage, prisma });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: Error) => {
  Logger.error(e.message, e.stack, 'Video');
  process.exit(1);
});
