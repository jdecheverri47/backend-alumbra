import { z } from 'zod';

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;

const pollSchema = z.object({
  options: z
    .array(z.string().trim().min(1).max(80))
    .min(POLL_MIN_OPTIONS)
    .max(POLL_MAX_OPTIONS)
    .refine(
      (options) => new Set(options.map((o) => o.toLowerCase())).size === options.length,
      'options must be distinct',
    ),
  // Hasta 30 días.
  durationHours: z.number().int().min(1).max(720).optional(),
});

export const createPostSchema = z.object({
  type: z.enum(['POST', 'ANUNCIO']).default('POST'),
  body: z.string().trim().min(1).max(5000),
  // URLs devueltas por POST /uploads (rutas locales) o URLs absolutas.
  imageUrls: z
    .array(z.string().trim().min(1).max(500))
    .max(10)
    .default([])
    .refine(
      (urls) => urls.every((u) => u.startsWith('/uploads/') || /^https?:\/\//.test(u)),
      'each image must be an /uploads/ path or an http(s) URL',
    ),
  eventId: z.string().trim().min(1).optional(),
  poll: pollSchema.optional(),
  membersOnly: z.boolean().default(false),
});

export const addCommentSchema = z.object({
  postId: z.string().trim().min(1),
  body: z.string().trim().min(1).max(1000),
});

export type CreatePostData = z.infer<typeof createPostSchema>;
export const votePollSchema = z.object({ optionId: z.string().trim().min(1) });

export type AddCommentData = z.infer<typeof addCommentSchema>;
