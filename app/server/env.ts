/**
 * Returns true when email verification is required for signup; false (the default) when it is not.
 *
 * Default is OFF (opt-in) for two reasons:
 *   1. Matches the old auth-ui behavior — the legacy app defaulted verification off.
 *   2. The staging environment has no email delivery configured; a required verification
 *      email would permanently strand email+password signups on "check your inbox."
 *
 * To require verification, set EMAIL_VERIFICATION=true in the environment (e.g. once SMTP
 * is configured, or for any environment that wants verified-on-signup email addresses).
 *
 * Security caveat: verification is skipped by default globally. This is safe today only
 * because production is IdP-only (no email+password signup path is exposed). Any environment
 * that enables password signup and wants verified emails MUST set EMAIL_VERIFICATION=true.
 *
 * TODO: EMAIL_VERIFICATION is currently read raw off `env` and is NOT in the validated env
 * schema (app/server/infra/env.server.ts). Promote it into that schema with a typed default
 * (false) and documentation so it becomes a first-class config knob rather than a raw read.
 */
export function requireEmailVerification(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.EMAIL_VERIFICATION === 'true';
}
