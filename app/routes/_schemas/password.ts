import { REQUEST_ID_PATTERN } from '../_shared/request-id';
import { z } from 'zod';

export const resetRequestSchema = z.object({
  loginName: z.string().min(1),
  organization: z.string().optional(),
  requestId: z.string().optional(),
});

export const newPasswordSchema = z
  .object({
    code: z.string().min(1),
    userId: z.string().min(1),
    password: z.string().min(8),
    confirm: z.string().min(8),
    organization: z.string().optional(),
    // CODE-MIN-24: reject a tampered mid-ceremony requestId at the boundary so it cannot
    // forward into /authorize. Allowlist matches the Zitadel-issued prefixes.
    requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords must match',
  });
