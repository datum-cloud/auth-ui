import { env } from '@/server/infra/env.server';
import { createCookie } from 'react-router';

/**
 * ONE-SHOT marker for /login/method's sole-linked-IdP auto-start: the loginName whose IdP
 * intent this browser has ALREADY been sent to the provider for.
 *
 * The auto-start lives in a LOADER (a server redirect, so the chooser never flashes), and a
 * loader re-runs on every arrival at the URL — including the one the browser makes when the
 * user presses Back at the provider. Without this marker that Back mints a brand-new Zitadel
 * intent and bounces them straight forward again: the user can never return to the app. With
 * it, the second arrival for the SAME loginName falls through and renders the chooser, whose
 * IdP button re-starts the ceremony deliberately (a POST, where Back does not re-fire).
 *
 * NEVER an auth signal and never rendered — it only suppresses one automatic redirect.
 * Same protection class as the `sessions` / `reauth-intent` cookies (which already store a
 * loginName): httpOnly, sameSite lax, scoped to `/id`, signed with SESSION_SECRET.
 * SHORT maxAge (10 min, matching reauth-intent): a sign-in completes promptly, and a stale
 * marker must not keep suppressing the no-flash fast path for a later, unrelated visit.
 */
export const idpAutostartCookie = createCookie('idp-autostart', {
  httpOnly: true,
  sameSite: 'lax',
  path: '/id',
  secure: env.NODE_ENV === 'production',
  secrets: [env.SESSION_SECRET],
  maxAge: 60 * 10, // 10 minutes
});

/** Serialize the marker (the loginName just auto-started) to a Set-Cookie string. */
export async function serializeIdpAutostart(loginName: string): Promise<string> {
  return idpAutostartCookie.serialize(loginName);
}

/**
 * Expire the marker — emitted by the IDENTIFIER submit, which is the moment a NEW sign-in
 * ceremony begins.
 *
 * The marker only ever needs to survive one ceremony: it exists to stop the Back-from-the-
 * provider arrival re-minting an intent, and Back does not re-POST the identifier. Left to its
 * own 10-minute maxAge it outlived the ceremony that wrote it, so a user who signed in, signed
 * out, and signed straight back in got the one-button chooser instead of the auto-start the
 * whole feature exists to give them. Clearing it here scopes the one-shot to exactly one
 * ceremony without weakening the Back guard at all.
 */
export async function clearIdpAutostart(): Promise<string> {
  return idpAutostartCookie.serialize('', { maxAge: 0 });
}

/** Read the marked loginName. Returns null when the cookie is absent, invalid, or empty. */
export async function readIdpAutostart(request: Request): Promise<string | null> {
  const value = await idpAutostartCookie.parse(request.headers.get('cookie'));
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * True when this browser has already been auto-started into an IdP for `loginName`.
 * Case-insensitive: the marker is written from the URL's loginName while the arrival that
 * reads it may carry a different casing of the same account (IdPs / SAML round-trips and
 * hand-typed identifiers both do this) — an exact compare would silently re-arm the trap.
 */
export function idpAutostartMatches(marker: string | null, loginName: string): boolean {
  return marker !== null && marker.trim().toLowerCase() === loginName.trim().toLowerCase();
}
