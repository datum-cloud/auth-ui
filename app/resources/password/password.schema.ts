import type { PasswordComplexity } from '@/modules/auth/types';
import { passwordComplexityField } from '@/resources/schemas/password-complexity';
import { withPasswordMatch } from '@/resources/schemas/password-match';
import { REQUEST_ID_PATTERN } from '@/resources/schemas/request-id';
import { z } from 'zod';

export const resetRequestSchema = z.object({
  loginName: z.string().min(1),
  organization: z.string().optional(),
  requestId: z.string().optional(),
});

// The password rules are POLICY-DRIVEN: the field validator is built from the org's fetched
// `PasswordComplexity` (min length + required character classes) rather than a hardcoded min(8).
// `<name>For(policy)` builds a schema for a specific policy; the default `<name>` (policy omitted)
// keeps the legacy min-8/no-classes behaviour for callers that have no policy in hand.
export function newPasswordSchemaFor(policy?: PasswordComplexity) {
  return withPasswordMatch(
    z.object({
      code: z.string().min(1),
      userId: z.string().min(1),
      password: passwordComplexityField(policy),
      confirm: z.string().min(1),
      organization: z.string().optional(),
      // Reject a tampered mid-ceremony requestId at the boundary so it cannot
      // forward into /authorize. Allowlist matches the Zitadel-issued prefixes.
      requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
    })
  );
}

export const newPasswordSchema = newPasswordSchemaFor();

export function changePasswordSchemaFor(policy?: PasswordComplexity) {
  return withPasswordMatch(
    z.object({
      sessionId: z.string().min(1),
      password: passwordComplexityField(policy),
      confirm: z.string().min(1),
      requestId: z.string().optional(),
    })
  );
}

export const changePasswordSchema = changePasswordSchemaFor();

// Client-side validation subsets; advisory only — the server action's schema is the real
// gate. Hoisted here so route components can import them without pulling in the server-only
// service via the barrel.

// reset.tsx: only the loginName field (organization/requestId come from hidden inputs).
export const resetRequestClientSchema = resetRequestSchema.pick({ loginName: true });

// new.tsx: only password+confirm match (code/userId come from hidden inputs). Policy-driven so the
// client rules mirror the fetched org policy; the loader threads the policy into `<name>For`.
export function newPasswordClientSchemaFor(policy?: PasswordComplexity) {
  return withPasswordMatch(
    z.object({ password: passwordComplexityField(policy), confirm: z.string().min(1) })
  );
}

export const newPasswordClientSchema = newPasswordClientSchemaFor();

// change.tsx: password+confirm match; sessionId comes via hidden input. Policy-driven, same as above.
// Message reconciled from the old 'Passwords do not match' drift to the shared
// 'Passwords must match' copy via the withPasswordMatch default.
export function changePasswordClientSchemaFor(policy?: PasswordComplexity) {
  return withPasswordMatch(
    z.object({ password: passwordComplexityField(policy), confirm: z.string().min(1) })
  );
}

export const changePasswordClientSchema = changePasswordClientSchemaFor();
