import type { PasswordComplexity } from '@/modules/auth/types';
import { passwordComplexityField } from '@/resources/schemas/password-complexity';
import { withPasswordMatch } from '@/resources/schemas/password-match';
import { z } from 'zod';

// NOTE: zod 4 ships z.email() as a top-level validator; z.string().email() still works
// (it delegates to z.email() internally) — we keep the string().email() form here
// because it keeps the schema consistent with the other string fields and satisfies
// the locked spec. If z.string().email() is deprecated in a future minor, swap to
// z.email() and drop the z.string() wrapper.
export const registerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  deviceTrackingToken: z.string().optional(),
  requestId: z.string().optional(),
  organization: z.string().optional(),
});

// client-side validation subset; advisory only (the server action's registerSchema is the real gate)
export const registerClientSchema = registerSchema.pick({
  email: true,
  firstName: true,
  lastName: true,
});

// Composes the shared withPasswordMatch refinement — same field names (password/
// confirm), same path, same "Passwords must match" copy the inline refinement emitted.
// POLICY-DRIVEN: the password field is built from the org's fetched `PasswordComplexity`
// (the loader/action thread it in via `<name>For`); the default keeps legacy min-8/no-classes.
export function signupPasswordSchemaFor(policy?: PasswordComplexity) {
  return withPasswordMatch(
    z.object({ password: passwordComplexityField(policy), confirm: z.string().min(1) })
  );
}

export const signupPasswordSchema = signupPasswordSchemaFor();

// Screen 1 (/signup): collect just the email identifier (name is parsed from it).
export const signupIdentifierSchema = z.object({
  email: z.string().email(),
  organization: z.string().optional(),
  requestId: z.string().optional(),
  deviceTrackingToken: z.string().optional(),
});

// Screen 2 (/signup/method): which credential the user chose.
export const signupMethodSchema = z.object({
  intent: z.enum(['email-link', 'passkey', 'password']),
  loginName: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  organization: z.string().optional(),
  requestId: z.string().optional(),
  deviceTrackingToken: z.string().optional(),
});
