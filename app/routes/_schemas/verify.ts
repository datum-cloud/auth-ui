import { z } from 'zod';

export const verifyCodeSchema = z.object({
  userId: z.string().min(1),
  code: z.string().min(1),
  invite: z.enum(['true', 'false']).optional(),
  loginName: z.string().optional(),
  organization: z.string().optional(),
  requestId: z.string().optional(),
});

export const changePasswordSchema = z
  .object({
    sessionId: z.string().min(1),
    password: z.string().min(8),
    confirm: z.string().min(8),
    requestId: z.string().optional(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords must match' });
