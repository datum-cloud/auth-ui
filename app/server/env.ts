import { env } from '@/server/infra/env.server';

/**
 * Returns true when email verification is required for signup; true (the default) unless
 * explicitly disabled.
 *
 * FAIL-CLOSED: unset => ON. Verification is the safe state — with it off, registerWithPassword
 * passes emailVerified:true and mints accounts on addresses nobody proved they own. To skip it
 * (e.g. a no-delivery staging deployment where password signup must complete without ever
 * sending mail), set AUTH_EMAIL_VERIFICATION_REQUIRED=false explicitly.
 */
export function requireEmailVerification(): boolean {
  return env.AUTH_EMAIL_VERIFICATION_REQUIRED;
}
