import { z } from 'zod';

export const createUserSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(3).max(30).optional(),
  birthDate: z.coerce.date().optional(),
});

export type CreateUserData = z.infer<typeof createUserSchema>;

// Acepta URLs absolutas o rutas locales devueltas por POST /uploads.
const imageUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((u) => u.startsWith('/uploads/') || /^https?:\/\//.test(u), {
    message: 'must be an /uploads/ path or an http(s) URL',
  });

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(3).max(30).nullable().optional(),
  photoUrl: imageUrl.nullable().optional(),
  coverUrl: imageUrl.nullable().optional(),
  birthDate: z.coerce.date().nullable().optional(),
});

export type UpdateUserData = z.infer<typeof updateUserSchema>;

export const membershipInfoSchema = z.object({
  membershipDate: z.coerce.date().nullable().optional(),
  baptismDate: z.coerce.date().nullable().optional(),
});

export type MembershipInfoData = z.infer<typeof membershipInfoSchema>;
