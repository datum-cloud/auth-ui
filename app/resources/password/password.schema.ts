import { REQUEST_ID_PATTERN } from '@/resources/schemas/request-id';
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
    // Reject a tampered mid-ceremony requestId at the boundary so it cannot
    // forward into /authorize. Allowlist matches the Zitadel-issued prefixes.
    requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords must match',
  });

export const changePasswordSchema = z
  .object({
    sessionId: z.string().min(1),
    password: z.string().min(8),
    confirm: z.string().min(8),
    requestId: z.string().optional(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords must match' });

// Client-side validation subsets; advisory only — the server action's schema is the real
// gate. Hoisted here so route components can import them without pulling in the server-only
// service via the barrel.

// reset.tsx: only the loginName field (organization/requestId come from hidden inputs).
export const resetRequestClientSchema = resetRequestSchema.pick({ loginName: true });

// new.tsx: only password+confirm match (code/userId come from hidden inputs).
export const newPasswordClientSchema = z
  .object({
    password: z.string().min(8),
    confirm: z.string().min(8),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords must match',
    path: ['confirm'],
  });

// change.tsx: password+confirm match; sessionId comes via hidden input.
export const changePasswordClientSchema = z
  .object({ password: z.string().min(8), confirm: z.string().min(8) })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
