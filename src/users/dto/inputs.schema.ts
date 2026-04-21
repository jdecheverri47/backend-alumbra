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

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(3).max(30).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  birthDate: z.coerce.date().nullable().optional(),
});

export type UpdateUserData = z.infer<typeof updateUserSchema>;
