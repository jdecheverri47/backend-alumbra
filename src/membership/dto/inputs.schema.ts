import { z } from 'zod';

const fileUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((u) => u.startsWith('/uploads/') || /^https?:\/\//.test(u), {
    message: 'must be an /uploads/ path or an http(s) URL',
  });

export const startJourneySchema = z.object({
  userId: z.string().trim().min(1),
  interviewerId: z.string().trim().min(1).optional(),
  preInterviewAt: z.coerce.date().optional(),
  preInterviewNotes: z.string().trim().max(2000).optional(),
});

export const submitFinalWorkSchema = z.object({
  essayUrl: fileUrl,
  testimony: z
    .string()
    .trim()
    .min(50, 'El testimonio debe tener al menos 50 caracteres.')
    .max(20000),
  imageUrl: fileUrl,
});

export const observationSchema = z.object({
  journeyId: z.string().trim().min(1),
  body: z.string().trim().min(5).max(4000),
});
