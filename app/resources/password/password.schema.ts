import { withPasswordMatch } from '@/resources/schemas/password-match';
import { REQUEST_ID_PATTERN } from '@/resources/schemas/request-id';
import { z } from 'zod';

export const resetRequestSchema = z.object({
  loginName: z.string().min(1),
  organization: z.string().optional(),
  requestId: z.string().optional(),
});

export const newPasswordSchema = withPasswordMatch(
  z.object({
    code: z.string().min(1),
    userId: z.string().min(1),
    password: z.string().min(8),
    confirm: z.string().min(8),
    organization: z.string().optional(),
    // Reject a tampered mid-ceremony requestId at the boundary so it cannot
    // forward into /authorize. Allowlist matches the Zitadel-issued prefixes.
    requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  })
);

export const changePasswordSchema = withPasswordMatch(
  z.object({
    sessionId: z.string().min(1),
    password: z.string().min(8),
    confirm: z.string().min(8),
    requestId: z.string().optional(),
  })
);

// Client-side validation subsets; advisory only — the server action's schema is the real
// gate. Hoisted here so route components can import them without pulling in the server-only
// service via the barrel.

// reset.tsx: only the loginName field (organization/requestId come from hidden inputs).
export const resetRequestClientSchema = resetRequestSchema.pick({ loginName: true });

// new.tsx: only password+confirm match (code/userId come from hidden inputs).
export const newPasswordClientSchema = withPasswordMatch(
  z.object({
    password: z.string().min(8),
    confirm: z.string().min(8),
  })
);

// change.tsx: password+confirm match; sessionId comes via hidden input.
// Message reconciled from the old 'Passwords do not match' drift to the shared
// 'Passwords must match' copy via the withPasswordMatch default.
export const changePasswordClientSchema = withPasswordMatch(
  z.object({ password: z.string().min(8), confirm: z.string().min(8) })
);
