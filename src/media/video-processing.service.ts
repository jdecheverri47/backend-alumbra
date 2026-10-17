import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { UploadStorage } from '../uploads/upload-storage';
import { processVideo, VIDEO_NAME } from './process-video';

/**
 * Pasa a HLS los videos que se publican, para que arranquen rápido. No bloquea
 * a quien publica: mientras tanto el video original se ve igual.
 *
 * - Con VIDEO_JOB (producción) lanza el trabajo de Cloud Run `video-hls`, que
 *   tiene ffmpeg y memoria de sobra, sin cargar la API.
 * - Sin él (desarrollo) lo hace aquí mismo, en segundo plano.
 * - VIDEO_PROCESSING=off lo apaga (tests).
 */
@Injectable()
export class VideoProcessingService {
  private readonly log = new Logger('Video');
  private auth?: GoogleAuth;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: UploadStorage,
    private readonly prisma: PrismaService,
  ) {}

  /** Recibe URLs tal como se guardan (/uploads/…); ignora lo que no sea un video subido. */
  enqueue(urls: Array<string | null | undefined>): void {
    if (this.config.get<string>('VIDEO_PROCESSING') === 'off') return;
    const names = [
      ...new Set(
        urls
          .map((u) => u?.match(/^\/uploads\/([^/?#]+)$/)?.[1])
          .filter((n): n is string => Boolean(n && VIDEO_NAME.test(n))),
      ),
    ];
    for (const name of names) {
      void this.start(name).catch((e: Error) =>
        this.log.error(`No se pudo procesar ${name}: ${e.message}`),
      );
    }
  }

  private async start(name: string): Promise<void> {
    const job = this.config.get<string>('VIDEO_JOB');
    if (!job) {
      await processVideo(name, { storage: this.storage, prisma: this.prisma });
      return;
    }
    this.auth ??= new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
    const client = await this.auth.getClient();
    // job = projects/<p>/locations/<r>/jobs/<nombre>
    await client.request({
      url: `https://run.googleapis.com/v2/${job}:run`,
      method: 'POST',
      data: { overrides: { containerOverrides: [{ args: ['dist/media/hls-job.js', name] }] } },
    });
    this.log.log(`Procesando ${name} en ${job.split('/').pop()}`);
  }
}
