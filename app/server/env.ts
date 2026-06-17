/**
 * Returns true when email verification is required (the default).
 * Only returns false when EMAIL_VERIFICATION is explicitly set to 'false'.
 * Used by the signup flow to decide whether to gate registration behind email confirmation.
 */
export function requireEmailVerification(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.EMAIL_VERIFICATION !== 'false';
}
