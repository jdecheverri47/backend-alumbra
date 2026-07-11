import { z } from 'zod';

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
});

export const addCommentSchema = z.object({
  postId: z.string().trim().min(1),
  body: z.string().trim().min(1).max(1000),
});

export type CreatePostData = z.infer<typeof createPostSchema>;
export type AddCommentData = z.infer<typeof addCommentSchema>;
