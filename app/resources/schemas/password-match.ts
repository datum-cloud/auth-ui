import { z } from 'zod';

// The shared passwords-match refinement — one consistent message + path. Composed
// into the password/signup schemas (it uses the same field names + copy they use
// today). The live schemas (resources/password/*.schema.ts, resources/signup/*.schema.ts)
// pair `password` with `confirm` and attach the issue to the `confirm` path with this exact
// copy, so those are the defaults; callers with a different shape override the field names.
const MISMATCH_MESSAGE = 'Passwords must match';

const DEFAULT_PASSWORD_FIELD = 'password';
const DEFAULT_CONFIRM_FIELD = 'confirm';

export interface PasswordMatchOptions {
  /** Field holding the primary password. Defaults to `password`. */
  passwordField?: string;
  /** Field holding the confirmation; the mismatch issue is attached here. Defaults to `confirm`. */
  confirmField?: string;
  /** Override the mismatch copy. Defaults to the live schemas' "Passwords must match". */
  message?: string;
}

// zod 4's `.refine()` returns `this` (the same ZodObject type) for non-guard checks —
// it no longer wraps in the removed `ZodEffects`. So the refined schema is still `T`.
export function withPasswordMatch<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  options: PasswordMatchOptions = {}
): T {
  const passwordField = options.passwordField ?? DEFAULT_PASSWORD_FIELD;
  const confirmField = options.confirmField ?? DEFAULT_CONFIRM_FIELD;
  const message = options.message ?? MISMATCH_MESSAGE;

  return schema.refine(
    (val) =>
      (val as Record<string, unknown>)[passwordField] ===
      (val as Record<string, unknown>)[confirmField],
    { message, path: [confirmField] }
  );
}
