import { z } from 'zod';

const meetingTimeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const createGroupSchema = z
  .object({
    type: z.enum(['MADUREZ', 'CONEXION', 'CURSO']),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    leaderId: z.string().trim().min(1).optional(),
    courseId: z.string().trim().min(1).optional(),
    meetingDay: z.number().int().min(0).max(6).optional(),
    meetingTime: z.string().regex(meetingTimeRegex, 'must be "HH:mm"').optional(),
    location: z.string().trim().max(200).optional(),
  })
  .refine((d) => (d.type === 'CURSO') === Boolean(d.courseId), {
    message: 'las cohortes (type CURSO) requieren courseId, y viceversa',
    path: ['courseId'],
  });

export const updateGroupSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  meetingDay: z.number().int().min(0).max(6).nullable().optional(),
  meetingTime: z.string().regex(meetingTimeRegex, 'must be "HH:mm"').nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
});

export const addUserToGroupSchema = z.object({
  userId: z.string().trim().min(1),
  groupId: z.string().trim().min(1),
});

export type CreateGroupData = z.infer<typeof createGroupSchema>;
export type UpdateGroupData = z.infer<typeof updateGroupSchema>;
export type AddUserToGroupData = z.infer<typeof addUserToGroupSchema>;
