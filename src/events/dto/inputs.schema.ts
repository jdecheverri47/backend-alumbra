import { z } from 'zod';

export const createEventSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional(),
    location: z.string().trim().max(200).optional(),
    // Opcional: un evento puede existir con la fecha por definir.
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    groupId: z.string().trim().min(1).optional(),
    membersOnly: z.boolean().optional(),
  })
  .refine((d) => !d.endsAt || d.startsAt, {
    message: 'endsAt requires startsAt',
    path: ['endsAt'],
  })
  .refine((d) => !d.endsAt || !d.startsAt || d.endsAt > d.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export const updateEventSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    // nullable: permite quitarle la fecha a un evento, o ponérsela cuando se confirma.
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    membersOnly: z.boolean().optional(),
  })
  .refine((d) => !d.endsAt || !d.startsAt || d.endsAt > d.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export type CreateEventData = z.infer<typeof createEventSchema>;
export type UpdateEventData = z.infer<typeof updateEventSchema>;
