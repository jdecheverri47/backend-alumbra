import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

const interests = z.array(
  z.enum(['CONOCER_MAS', 'GRUPO_CONEXION', 'BAUTISMO', 'SERVIR', 'ORACION', 'CONSEJERIA']),
);

const newcomerFields = {
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: optionalText(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .transform((v) => v || null)
    .pipe(z.string().email().nullable())
    .nullish(),
  birthDate: z.coerce.date().nullish(),
  neighborhood: optionalText(120),
  firstVisitAt: z.coerce.date().optional(),
  howHeard: optionalText(200),
  invitedBy: optionalText(120),
  interests: interests.optional(),
  prayerRequest: optionalText(2000),
  notes: optionalText(2000),
  consent: z.boolean().optional(),
};

export const registerNewcomerSchema = z.object(newcomerFields);
export const updateNewcomerSchema = z.object(newcomerFields).partial();

export const addFollowUpSchema = z.object({
  newcomerId: z.string().trim().min(1),
  kind: z.enum(['LLAMADA', 'MENSAJE', 'VISITA', 'ENCUENTRO', 'OTRO']).default('LLAMADA'),
  note: z.string().trim().min(1).max(2000),
});

export type RegisterNewcomerData = z.infer<typeof registerNewcomerSchema>;
export type UpdateNewcomerData = z.infer<typeof updateNewcomerSchema>;
