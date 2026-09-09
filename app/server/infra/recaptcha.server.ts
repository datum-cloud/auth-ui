import { env } from '@/server/infra/env.server';
import { logAuthEvent } from '@/server/observability';

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const REQUEST_TIMEOUT_MS = 2000;
const MAX_TOKEN_AGE_MS = 2 * 60_000;

export type RecaptchaReason =
  | 'ok'
  | 'not-configured'
  | 'no-token'
  | 'rejected'
  | 'action-mismatch'
  | 'stale'
  | 'hostname-mismatch'
  | 'transport';

/**
 * Google's documented siteverify error codes. Anything outside this set collapses to
 * 'unknown': these reach a log line, and echoing arbitrary upstream text there would let a
 * hostile or malfunctioning response forge log entries. Same reasoning that makes
 * RecaptchaReason a closed union rather than a free string.
 */
const KNOWN_ERROR_CODES = [
  'missing-input-secret',
  'invalid-input-secret',
  'missing-input-response',
  'invalid-input-response',
  'invalid-keys',
  'bad-request',
  'timeout-or-duplicate',
] as const;

export type RecaptchaErrorCode = (typeof KNOWN_ERROR_CODES)[number] | 'unknown';

function normaliseErrorCodes(raw: unknown): RecaptchaErrorCode[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  // Bounded: a response claiming hundreds of codes must not become a hundred-field log entry.
  return raw
    .slice(0, 5)
    .map((c) =>
      (KNOWN_ERROR_CODES as readonly unknown[]).includes(c) ? (c as RecaptchaErrorCode) : 'unknown'
    );
}

export type RecaptchaVerdict = {
  outcome: 'valid' | 'invalid' | 'unavailable';
  score: number | null;
  reason: RecaptchaReason;
  /** Google's own codes, allowlisted. Absent when the response carried none. `rejected`
   *  collapses several distinct causes; this is what tells them apart in a log. */
  errorCodes?: RecaptchaErrorCode[];
};

export function recaptchaConfigured(): boolean {
  return Boolean(env.RECAPTCHA_SITE_KEY && env.RECAPTCHA_SECRET_KEY);
}

/** Verifies a token against Google. Never throws — every failure returns a verdict. */
export async function verifyRecaptcha(
  token: string,
  expectedAction: string
): Promise<RecaptchaVerdict> {
  // Read into a local so the fetch below needs no `as string` cast.
  const secret = env.RECAPTCHA_SECRET_KEY;
  if (!secret || !env.RECAPTCHA_SITE_KEY) {
    return { outcome: 'valid', score: null, reason: 'not-configured' };
  }

  // A missing token is ambiguous: a scripted POST, or a real browser during a Google
  // outage. The client cannot tell us which — any "widget failed" flag it sends is one a
  // bot sends too. So we resolve it here: send the empty token anyway, and if Google
  // answers at all, the browser should have minted one and did not.
  let body: {
    success?: boolean;
    score?: number;
    action?: string;
    hostname?: string;
    challenge_ts?: string;
    'error-codes'?: unknown;
  };

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { outcome: 'unavailable', score: null, reason: 'transport' };
    // `?? {}` guards a 2xx whose body is literally `null`: the reads below sit outside this
    // try, so a TypeError there would escape and break the never-throws contract.
    body = (await res.json()) ?? {};
  } catch {
    return { outcome: 'unavailable', score: null, reason: 'transport' };
  }

  const errorCodes = normaliseErrorCodes(body['error-codes']);

  if (!token) return { outcome: 'invalid', score: null, reason: 'no-token', errorCodes };

  const score = typeof body.score === 'number' ? body.score : null;

  if (!body.success) return { outcome: 'invalid', score, reason: 'rejected', errorCodes };
  if (body.action !== expectedAction) {
    return { outcome: 'invalid', score, reason: 'action-mismatch' };
  }

  // Math.abs so a backward-skewed clock cannot silently disable this check.
  const issued = body.challenge_ts ? Date.parse(body.challenge_ts) : NaN;
  if (Number.isNaN(issued) || Math.abs(Date.now() - issued) > MAX_TOKEN_AGE_MS) {
    return { outcome: 'invalid', score, reason: 'stale' };
  }

  // The only control against someone farming tokens with our public site key on their own
  // domain. env.server refuses to boot when the secret is set without PUBLIC_ORIGIN, so
  // this guard is a fallback rather than a live skip path.
  if (body.hostname && env.PUBLIC_ORIGIN) {
    const expectedHost = new URL(env.PUBLIC_ORIGIN).hostname;
    if (body.hostname !== expectedHost) {
      return { outcome: 'invalid', score, reason: 'hostname-mismatch' };
    }
  }

  return { outcome: 'valid', score, reason: 'ok' };
}

/**
 * The full bot gate: verify, record the verdict, and answer whether to reject.
 * Returns true when the caller must return 400 before any Zitadel work.
 *
 * Every account-creating entry point calls this rather than verifyRecaptcha directly, so
 * the gated set stays enumerable. Callers must still run it before any account lookup, or
 * the fast reject path becomes an enumeration timing oracle (G7).
 */
export async function recaptchaRejects(token: string, expectedAction: string): Promise<boolean> {
  const verdict = await verifyRecaptcha(token, expectedAction);

  // Unconfigured deployments stay dark, audit trail included — otherwise the metric reads
  // as a healthy gate where there is no gate.
  if (verdict.reason !== 'not-configured') {
    logAuthEvent(
      'signup_recaptcha_scored',
      verdict.outcome === 'unavailable' ? 'failure' : 'success',
      {
        verdict: verdict.outcome,
        reason: verdict.reason,
        score: verdict.score,
        action: expectedAction,
        ...(verdict.errorCodes ? { errorCodes: verdict.errorCodes } : {}),
      }
    );
  }

  // 'unavailable' is Google failing us, not the caller — fail open.
  return verdict.outcome === 'invalid';
}
