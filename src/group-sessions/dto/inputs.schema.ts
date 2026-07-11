import { z } from 'zod';

const fileUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((u) => u.startsWith('/uploads/') || /^https?:\/\//.test(u), {
    message: 'must be an /uploads/ path or an http(s) URL',
  });

export const createSessionSchema = z.object({
  groupId: z.string().trim().min(1),
  scheduledFor: z.coerce.date(),
  startsAt: z.coerce.date().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  lessonId: z.string().trim().min(1).optional(),
});

export const rescheduleSessionSchema = z.object({
  startsAt: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
});

export const materialSchema = z.object({
  sessionId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160),
  url: fileUrl,
});

export const assignmentSchema = z.object({
  sessionId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  dueAt: z.coerce.date().optional(),
});

export const submissionSchema = z.object({
  assignmentId: z.string().trim().min(1),
  url: fileUrl,
});
