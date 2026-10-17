import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { Public } from '../auth/decorators/public.decorator';
import {
  extensionFor,
  FILE_TYPE_ERROR,
  maxBytesFor,
  MULTIPART_MAX_BYTES,
  STORED_NAME,
} from './upload-rules';
import { DiskUploadStorage, UPLOAD_DIR, UploadStorage, UploadTarget } from './upload-storage';

const intentSchema = z.object({
  contentType: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
  filename: z.string().max(300).optional(),
});

/**
 * La redirección a la URL firmada se cachea un poco menos de lo que dura la
 * firma, así el navegador no vuelve a preguntar en cada pantalla.
 */
const READ_REDIRECT_MAX_AGE = 50 * 60;

/** Listas ya firmadas (y comprimidas), mientras duren sus firmas. */
/**
 * Firma de los videos dentro de una lista. La lista se cachea ~1 h aquí y otra
 * en el navegador, y una clase dura hasta 2-3 h: con 12 h sobra.
 */
const PLAYLIST_MEDIA_HOURS = 12;

const playlistCache = new Map<string, { text: string; gzip: Buffer; expiresAt: number }>();
const PLAYLIST_CACHE_MS = READ_REDIRECT_MAX_AGE * 1000;

function storedName(contentType: string, filename?: string): string {
  return `${randomUUID()}${extensionFor(contentType, filename)}`;
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: UploadStorage) {}

  /**
   * Subida que pasa por el servidor, para archivos chicos (hasta 10 MB).
   * Requiere sesión (guard global): a propósito no es @Public.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MULTIPART_MAX_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (maxBytesFor(file.mimetype) === null) {
          cb(new BadRequestException(FILE_TYPE_ERROR), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('Falta el archivo (campo "file").');
    const name = storedName(file.mimetype, file.originalname);
    await this.storage.save(name, file.buffer, file.mimetype);
    return { url: `/uploads/${name}` };
  }

  /**
   * Subida directa desde el navegador (videos y todo lo grande): devuelve a
   * dónde hacer el PUT y la URL con la que queda guardado el archivo.
   */
  @Post('intent')
  @HttpCode(200)
  async intent(@Body() raw: unknown): Promise<UploadTarget & { url: string }> {
    const parsed = intentSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Datos de subida inválidos.');
    const { contentType, size, filename } = parsed.data;

    const maxBytes = maxBytesFor(contentType);
    if (maxBytes === null) throw new BadRequestException(FILE_TYPE_ERROR);
    if (size > maxBytes) {
      throw new PayloadTooLargeException(
        `El archivo pesa más de ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      );
    }

    const name = storedName(contentType, filename);
    const target = await this.storage.createUploadTarget(name, contentType, maxBytes);
    return { ...target, url: `/uploads/${name}` };
  }

  /** Solo en disco: recibe el PUT de la subida directa. El token es la firma. */
  @Public()
  @Put('direct/:name')
  async direct(
    @Param('name') name: string,
    @Query('token') token: string | undefined,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    if (!(this.storage instanceof DiskUploadStorage)) throw new NotFoundException();
    const grant = STORED_NAME.test(name) && token ? this.storage.verify(name, token) : null;
    if (!grant) throw new ForbiddenException('La URL de subida no es válida o venció.');
    if (req.headers['content-type'] !== grant.contentType) {
      throw new BadRequestException('El tipo del archivo no coincide con el anunciado.');
    }

    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > grant.maxBytes)
          cb(new PayloadTooLargeException('El archivo es muy grande.'));
        else cb(null, chunk);
      },
    });

    const path = join(UPLOAD_DIR, name);
    const partial = `${path}.part`;
    try {
      await pipeline(req, limit, createWriteStream(partial));
      await rename(partial, path);
    } catch (e) {
      await rm(partial, { force: true });
      throw e;
    }
    return { ok: true };
  }

  /**
   * Leer un archivo. Público como siempre fue /uploads: el nombre es un uuid
   * imposible de adivinar. En GCS redirige a una URL firmada (que soporta Range,
   * así los videos se pueden adelantar); en disco lo sirve directo.
   */
  @Public()
  @Get(':name')
  async read(
    @Param('name') name: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!STORED_NAME.test(name)) throw new NotFoundException();
    if (name.endsWith('.m3u8')) return this.playlist(name, req, res);

    const signed = await this.storage.readUrl(name);
    if (signed) {
      res.setHeader('Cache-Control', `private, max-age=${READ_REDIRECT_MAX_AGE}`);
      res.redirect(302, signed);
      return;
    }

    if (!existsSync(join(UPLOAD_DIR, name))) throw new NotFoundException();
    res.sendFile(name, { root: UPLOAD_DIR, maxAge: '365d', immutable: true });
  }

  /**
   * Lista de reproducción HLS de un video. El video va en un solo archivo y la
   * lista lo pide por rangos de bytes, así que basta con cambiar su nombre por
   * una URL firmada (en disco se deja tal cual: el navegador lo pide aquí
   * mismo). Va directo al bucket y no por la redirección: un pedido entre
   * dominios que se redirige pierde el Origin y el bucket lo rechaza por CORS.
   */
  private async playlist(name: string, req: Request, res: Response): Promise<void> {
    let entry = playlistCache.get(name);
    if (!entry || entry.expiresAt < Date.now()) {
      const text = await this.signPlaylist(name);
      if (playlistCache.size > 500) playlistCache.clear();
      // La URL firmada se repite en cada línea: comprimida pesa casi nada.
      entry = { text, gzip: gzipSync(text), expiresAt: Date.now() + PLAYLIST_CACHE_MS };
      playlistCache.set(name, entry);
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    // Dura menos que las firmas que lleva adentro.
    res.setHeader('Cache-Control', `private, max-age=${READ_REDIRECT_MAX_AGE}`);
    res.setHeader('Vary', 'Accept-Encoding');
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      res.setHeader('Content-Encoding', 'gzip');
      res.send(entry.gzip);
    } else {
      res.send(entry.text);
    }
  }

  /** La lista con el archivo de video cambiado por su URL firmada. */
  private async signPlaylist(name: string): Promise<string> {
    const text = await this.storage.readText(name);
    if (text === null) throw new NotFoundException();
    // Todas las líneas apuntan al mismo archivo: una sola firma por archivo.
    const signed = new Map<string, Promise<string>>();
    const sign = (ref: string): Promise<string> => {
      if (!STORED_NAME.test(ref) || ref.endsWith('.m3u8')) return Promise.resolve(ref);
      if (!signed.has(ref)) {
        signed.set(
          ref,
          this.storage.readUrl(ref, PLAYLIST_MEDIA_HOURS).then((url) => url ?? ref),
        );
      }
      return signed.get(ref)!;
    };

    const lines = await Promise.all(
      text.split('\n').map(async (line) => {
        if (line.startsWith('#EXT-X-MAP:')) {
          const match = /URI="([^"]+)"/.exec(line);
          return match ? line.replace(match[1], await sign(match[1])) : line;
        }
        return line && !line.startsWith('#') ? sign(line.trim()) : line;
      }),
    );
    return lines.join('\n');
  }
}
