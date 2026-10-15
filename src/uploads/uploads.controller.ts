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
  async read(@Param('name') name: string, @Res() res: Response): Promise<void> {
    if (!STORED_NAME.test(name)) throw new NotFoundException();

    const signed = await this.storage.readUrl(name);
    if (signed) {
      res.setHeader('Cache-Control', `private, max-age=${READ_REDIRECT_MAX_AGE}`);
      res.redirect(302, signed);
      return;
    }

    if (!existsSync(join(UPLOAD_DIR, name))) throw new NotFoundException();
    res.sendFile(name, { root: UPLOAD_DIR, maxAge: '365d', immutable: true });
  }
}
