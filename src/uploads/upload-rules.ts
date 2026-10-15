import { extname } from 'node:path';

const MB = 1024 * 1024;

/** Tipo de archivo → extensión con la que se guarda. */
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

// Documentos: material de clase y trabajos.
const DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'application/zip': '.zip',
};

export const IMAGE_MAX_BYTES = 15 * MB;
export const VIDEO_MAX_BYTES = 200 * MB;
export const DOCUMENT_MAX_BYTES = 25 * MB;

/**
 * Lo que pasa por el servidor (multipart). Cloud Run corta los cuerpos de más
 * de 32 MB; los videos van directo al bucket con una URL firmada.
 */
export const MULTIPART_MAX_BYTES = 10 * MB;

export const FILE_TYPE_ERROR =
  'Tipo de archivo no permitido. Se aceptan imágenes, videos (MP4, MOV, WebM), PDF, Office, texto y ZIP.';

export function isVideo(contentType: string): boolean {
  return contentType in VIDEO_TYPES;
}

/** Tamaño máximo para ese tipo, o null si el tipo no se acepta. */
export function maxBytesFor(contentType: string): number | null {
  if (contentType in IMAGE_TYPES) return IMAGE_MAX_BYTES;
  if (contentType in VIDEO_TYPES) return VIDEO_MAX_BYTES;
  if (contentType in DOCUMENT_TYPES) return DOCUMENT_MAX_BYTES;
  return null;
}

/**
 * Extensión del archivo guardado. Sale del tipo, nunca del nombre que manda el
 * cliente; el nombre solo desempata cuando el tipo no tiene una conocida.
 */
export function extensionFor(contentType: string, filename?: string): string {
  const known = IMAGE_TYPES[contentType] ?? VIDEO_TYPES[contentType] ?? DOCUMENT_TYPES[contentType];
  if (known) return known;
  const fromName = filename ? extname(filename).toLowerCase() : '';
  return /^\.[a-z0-9]{1,10}$/.test(fromName) ? fromName : '.bin';
}

/** Los nombres que genera el servidor: uuid + extensión. Nada más se sirve. */
export const STORED_NAME = /^[0-9a-f-]{36}\.[a-z0-9]{1,10}$/;
