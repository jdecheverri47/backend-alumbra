import { z } from 'zod';

export const googleLoginSchema = z.object({
  credential: z.string().min(1),
  // Solo los manda quien todavía no tiene acceso: completan la solicitud para
  // que Acogida pueda reconocerlos.
  phone: z.string().trim().min(3).max(30).optional(),
  note: z.string().trim().min(1).max(500).optional(),
});

export type GoogleLoginData = z.infer<typeof googleLoginSchema>;
