import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+[smhd]$/, 'Expected a duration like "15m", "900s", "1h"')
    .default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().optional(),
  // OAuth Client ID (tipo web) del proyecto de GCP. Sin él, POST /auth/google
  // responde 503 y el resto de la app funciona igual.
  GOOGLE_CLIENT_ID: z.string().optional(),
  // Bucket de GCS para los archivos subidos. Sin él se guardan en la carpeta
  // local uploads/ (desarrollo y tests).
  GCS_BUCKET: z.string().optional(),
  // Trabajo de Cloud Run que pasa los videos a HLS
  // (projects/<p>/locations/<r>/jobs/<nombre>). Sin él, se hace en el proceso.
  VIDEO_JOB: z.string().optional(),
  // "off" desactiva el procesamiento de videos (tests).
  VIDEO_PROCESSING: z.enum(['on', 'off']).optional(),
  // Uno o varios orígenes separados por comas: el sitio se sirve en el dominio
  // apex y en www, y son orígenes distintos para el navegador.
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .refine(
      (value) => parseOrigins(value).every((o) => z.string().url().safeParse(o).success),
      'Expected one or more URLs separated by commas',
    ),
});

/** Divide CORS_ORIGIN en la lista de orígenes, sin espacios ni entradas vacías. */
export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export type Env = z.infer<typeof envSchema>;

export function validateEnv(input: Record<string, unknown>): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

/** Parses a duration like "15m" / "900s" / "1h" / "7d" into seconds. */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const value = Number(match[1]);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return value * unit;
}
