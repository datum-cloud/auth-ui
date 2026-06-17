import { z } from 'zod';

export const verifyCodeSchema = z.object({
  userId: z.string().min(1),
  code: z.string().min(1),
  invite: z.enum(['true', 'false']).optional(),
  loginName: z.string().optional(),
  organization: z.string().optional(),
  requestId: z.string().optional(),
});

// Client-side validation: only the code field (userId etc. come from hidden inputs)
export const verifyCodeClientSchema = z.object({ code: z.string().min(1) });
