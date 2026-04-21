import { z } from 'zod';

const slugRegex = /^[a-z][a-z0-9-]*$/;

export const createMinistrySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(slugRegex, 'must be kebab-case (lowercase letters, digits, hyphens)'),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});

export const updateMinistrySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export type CreateMinistryData = z.infer<typeof createMinistrySchema>;
export type UpdateMinistryData = z.infer<typeof updateMinistrySchema>;
