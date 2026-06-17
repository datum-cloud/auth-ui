import { data } from 'react-router';

/**
 * Enumeration-safe "check your email" response helper.
 *
 * SECURITY: Both the new-user path and the duplicate-email (ALREADY_EXISTS) path
 * MUST return the same response when email verification is required. Sharing a single
 * function in this module makes that structural guarantee explicit — callers cannot
 * accidentally diverge by copy-pasting or writing their own version.
 *
 * Timing hardening (constant-delay no-op) is a Phase 6 item (ENH-01).
 */
export function genericCheckYourEmail(email: string) {
  return data({ sent: true as const, email }, { status: 200 });
}
