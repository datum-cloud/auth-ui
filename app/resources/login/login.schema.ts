// Server-free schema definitions for the login domain.
// IMPORTANT: this module must import ONLY 'zod' and '@/resources/schemas/request-id'.
// It must never import @/server/*, the login service, cookies, env, sentry, or
// observability — route COMPONENTS depend on it for client validators, so it has
// to stay safe to bundle into the browser.
import { REQUEST_ID_PATTERN } from '@/resources/schemas/request-id';
import { z } from 'zod';

// Identifier (login-name) submission parsed by the /login action.
export const loginIdentifierSchema = z.object({
  loginName: z.string().min(1).max(200),
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  organization: z.string().optional(),
});

// IdP intent submission parsed by the /login action.
export const loginIdpSchema = z.object({
  intent: z.literal('idp'),
  idpId: z.string().min(1),
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  organization: z.string().optional(),
  // MaxMind device-fingerprint token captured client-side; forwarded through the IdP
  // round-trip so the resulting session carries fraud-tracking metadata.
  deviceTrackingToken: z.string().optional(),
});

// Client-side validation subset for the /login identifier form; advisory only
// (the server action's schema is the real gate).
export const loginIdentifierClientSchema = z.object({
  loginName: z.string({ error: 'Field is required.' }).min(1),
});

/**
 * Phone-shaped identifier detector. Requires NO `@` (so it never matches an email or a
 * domain-suffixed username like `alice@acme.test`) AND a phone shape: optional leading `+`,
 * then ≥6 digits with the usual separators. Used by the client schema + the /login action
 * to strict-reject phone input when the org disables phone login.
 */
export function isPhoneLike(value: string): boolean {
  const v = value.trim();
  if (v.includes('@')) return false;
  return /^\+?[0-9][0-9\s().-]{5,}$/.test(v);
}

/**
 * Email-shaped identifier detector: local@domain.tld. NOTE: this also matches Zitadel
 * domain-suffixed usernames (alice@acme.zitadel.cloud) — that overlap is intentional and
 * safe because this is used ONLY to choose error copy after a failed lookup, never to block
 * input (see resolveIdentifier).
 */
export function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const PHONE_DISABLED_MESSAGE = "Phone sign-in isn't available — use your email or username.";

/**
 * Client-side identifier validator. Advisory only (the server action re-checks). When
 * `rejectPhone`, a phone-format loginName fails with the phone message; email stays lenient.
 */
export function makeLoginIdentifierClientSchema({ rejectPhone }: { rejectPhone: boolean }) {
  const loginName = rejectPhone
    ? z
        .string({ error: 'Field is required.' })
        .min(1)
        .refine((v) => !isPhoneLike(v), { message: PHONE_DISABLED_MESSAGE })
    : z.string().min(1);
  return z.object({ loginName });
}

// Password submission parsed by the /login/password action.
export const loginPasswordSchema = z.object({
  password: z.string({ error: 'Password is required.' }).min(1).max(512),
  loginName: z.string().min(1),
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  organization: z.string().optional(),
});

// Client-side validation subset for the /login/password form; advisory only
// (the server action's schema is the real gate).
export const loginPasswordClientSchema = z.object({
  password: z.string({ error: 'Password is required.' }).min(1),
});
