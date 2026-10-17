import { Storage, type Bucket } from '@google-cloud/storage';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

/** Cuánto vive la URL para subir un archivo. */
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

/** Dónde y cómo tiene que subir el navegador el archivo. */
export interface UploadTarget {
  /** Absoluta (GCS) o relativa al backend (disco). */
  uploadUrl: string;
  method: 'PUT';
  /** Cabeceras que el navegador tiene que mandar tal cual: van firmadas. */
  headers: Record<string, string>;
}

export abstract class UploadStorage {
  /** Guarda un archivo que ya pasó por el servidor (multipart). */
  abstract save(name: string, data: Buffer, contentType: string): Promise<void>;

  /** Prepara la subida directa desde el navegador. */
  abstract createUploadTarget(
    name: string,
    contentType: string,
    maxBytes: number,
  ): Promise<UploadTarget>;

  /** URL firmada para leer el archivo; null si se sirve desde el disco. */
  abstract readUrl(name: string): Promise<string | null>;

  /** El contenido de un archivo de texto (las listas .m3u8 de los videos); null si no existe. */
  abstract readText(name: string): Promise<string | null>;
}

/**
 * Producción: bucket privado de GCS. Se lee y se sube con URLs firmadas V4; en
 * Cloud Run no hay llave privada y la librería firma con la API de IAM
 * (signBlob), así que la service account necesita Token Creator sobre sí misma.
 */
export class GcsUploadStorage extends UploadStorage {
  private readonly bucket: Bucket;
  /** Reusar la misma URL firmada deja que el navegador cachee el archivo. */
  private readonly readCache = new Map<string, { url: string; expiresAt: number }>();

  constructor(bucketName: string) {
    super();
    this.bucket = new Storage().bucket(bucketName);
  }

  async save(name: string, data: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(name).save(data, { contentType, resumable: false });
  }

  async createUploadTarget(
    name: string,
    contentType: string,
    maxBytes: number,
  ): Promise<UploadTarget> {
    // El tamaño máximo va firmado: GCS rechaza el PUT si el cuerpo se pasa.
    const headers = { 'x-goog-content-length-range': `0,${maxBytes}` };
    const [uploadUrl] = await this.bucket.file(name).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + UPLOAD_URL_TTL_MS,
      contentType,
      extensionHeaders: headers,
    });
    return { uploadUrl, method: 'PUT', headers: { 'Content-Type': contentType, ...headers } };
  }

  async readText(name: string): Promise<string | null> {
    try {
      const [data] = await this.bucket.file(name).download();
      return data.toString('utf8');
    } catch (e) {
      if ((e as { code?: number }).code === 404) return null;
      throw e;
    }
  }

  async readUrl(name: string): Promise<string> {
    const now = Date.now();
    const cached = this.readCache.get(name);
    // Margen de una hora: la URL entregada sigue sirviendo mientras el
    // navegador la tenga cacheada (ver READ_REDIRECT_MAX_AGE).
    if (cached && cached.expiresAt - now > 60 * 60 * 1000) return cached.url;

    const expiresAt = now + 2 * 60 * 60 * 1000;
    const [url] = await this.bucket.file(name).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt,
    });
    if (this.readCache.size > 5000) this.readCache.clear();
    this.readCache.set(name, { url, expiresAt });
    return url;
  }
}

/**
 * Desarrollo y tests: carpeta local. La subida directa apunta al propio backend
 * (PUT /uploads/direct/:name) con un token HMAC que hace las veces de firma.
 */
export class DiskUploadStorage extends UploadStorage {
  constructor(private readonly secret: string) {
    super();
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  async save(name: string, data: Buffer): Promise<void> {
    await writeFile(join(UPLOAD_DIR, name), data);
  }

  async createUploadTarget(
    name: string,
    contentType: string,
    maxBytes: number,
  ): Promise<UploadTarget> {
    const token = this.sign({ name, contentType, maxBytes, exp: Date.now() + UPLOAD_URL_TTL_MS });
    return {
      uploadUrl: `/uploads/direct/${name}?token=${encodeURIComponent(token)}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    };
  }

  async readUrl(): Promise<null> {
    return null;
  }

  async readText(name: string): Promise<string | null> {
    const path = join(UPLOAD_DIR, name);
    return existsSync(path) ? readFile(path, 'utf8') : null;
  }

  /** Comprueba el token de PUT /uploads/direct; null si no vale o venció. */
  verify(name: string, token: string): { contentType: string; maxBytes: number } | null {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = this.hmac(payload);
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        name: string;
        contentType: string;
        maxBytes: number;
        exp: number;
      };
      if (data.name !== name || data.exp < Date.now()) return null;
      return { contentType: data.contentType, maxBytes: data.maxBytes };
    } catch {
      return null;
    }
  }

  private sign(data: object): string {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${payload}.${this.hmac(payload).toString()}`;
  }

  private hmac(payload: string): Buffer {
    const digest = createHmac('sha256', this.secret)
      .update(`upload:${payload}`)
      .digest('base64url');
    return Buffer.from(digest);
  }
}
