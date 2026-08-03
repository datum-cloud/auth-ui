// app/server/signed-param.ts
//
// Detached HMAC-SHA256 signatures for values that must survive a round-trip through an
// ATTACKER-CONTROLLED carrier and still be trusted on the way back.
//
// Every other value we hand to a browser and read again rides a signed cookie
// (`sessions`, `reauth-intent`, `idp-autostart`, …) — react-router's `createCookie({ secrets })`
// does the signing there. A QUERY PARAM on an IdP return URL cannot use that machinery: the
// URL is handed to the IdP broker, which redirects the browser to it directly, so the value
// travels in the open and anyone who can craft a callback URL can put whatever they like in it.
// A `.max(64)` on the way back proves nothing about WHO wrote it.
//
// Same secret and the same HMAC-SHA256 construction the cookies use (SESSION_SECRET, validated
// >= 32 chars at boot), so there is one key to rotate and one primitive to reason about.
import { env } from '@/server/infra/env.server';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Domain separation. A signature minted for one param must never validate as another — without
 * a purpose in the MAC input, a signed `policyOrg=<org>` and any future signed param carrying the
 * same string would be interchangeable, and the narrower capability could be swapped in for the
 * wider one.
 */
function digest(purpose: string, value: string): Buffer {
  return createHmac('sha256', env.SESSION_SECRET).update(`${purpose}:${value}`).digest();
}

/** base64url HMAC over `purpose:value`. URL-safe, so it needs no extra escaping in a query. */
export function signParam(purpose: string, value: string): string {
  return digest(purpose, value).toString('base64url');
}

/**
 * True only for a signature THIS deployment minted for exactly this purpose + value.
 * Absent, malformed, truncated, and forged signatures are all plain `false` — callers are
 * expected to fall back to whatever they would have used with no value at all, never to
 * trust the unverified value.
 */
export function verifyParam(
  purpose: string,
  value: string,
  signature: string | null | undefined
): boolean {
  if (!signature) return false;
  const expected = digest(purpose, value);
  // Buffer.from does not throw on stray base64url characters — it decodes what it can — so the
  // length check is what rejects a malformed signature before timingSafeEqual (which throws on
  // mismatched lengths). Comparison itself stays constant-time.
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
