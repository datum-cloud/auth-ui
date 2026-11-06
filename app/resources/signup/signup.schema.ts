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

// A person's name as Zitadel's AddHumanUser accepts it: profile.givenName/familyName must be
// 1–200 runes. Trimmed first so a whitespace-only entry fails here instead of at Zitadel.
// Every failure carries readable copy: conform submits an empty field as `undefined`, so
// without the type-level `error` the user would see Zod's "expected string, received undefined".
function personName(label: string) {
  const required = `Enter your ${label}`;
  return z
    .string({ error: required })
    .trim()
    .min(1, { error: required })
    .max(200, { error: `Your ${label} must be 200 characters or fewer` });
}

// Screen 1 (/signup): the email identifier plus the user's real name. The name used to be
// derived from the email's local part (placeholder-name.ts), which left every email signup
// named "jane.doe jane.doe" until they filled in cloud-portal's "Complete your profile" screen.
// Asking up front means the account carries a real name from the first write.
export const signupIdentifierSchema = z.object({
  email: z
    .string({ error: 'Enter your email address' })
    .email({ error: 'Enter a valid email address' }),
  firstName: personName('first name'),
  lastName: personName('last name'),
  organization: z.string().optional(),
  requestId: z.string().optional(),
  deviceTrackingToken: z.string().optional(),
});

// Screen 1 (/signup), code branch: the emailed code, typed instead of clicked.
//
// `code` carries NO shape rule — no length, charset or case. The format is Zitadel configuration
// we do not own, so any rule here becomes a form that rejects valid codes the day that config
// changes, and it fails before the request where there is no audit trail. Trim only.
export const signupCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().trim().min(1),
  organization: z.string().optional(),
  requestId: z.string().optional(),
});

// Screen 2 (/signup/method): which credential the user chose.
//
// Passkey-only: signup registers passkeys and nothing else. The retired 'email-link' and
// 'password' intents are rejected HERE, at the parse boundary, so a hand-crafted POST (or a
// stale form cached from before this change) fails closed rather than reaching a branch the
// screen no longer offers.
export const signupMethodSchema = z.object({
  intent: z.literal('passkey'),
  loginName: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  organization: z.string().optional(),
  requestId: z.string().optional(),
  deviceTrackingToken: z.string().optional(),
});
