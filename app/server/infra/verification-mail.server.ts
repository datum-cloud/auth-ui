// app/server/infra/verification-mail.server.ts
//
// Server-only mTLS client to the zitadel-provider authn-webhook that creates a milo `Email`
// resource carrying the verification code. This REPLACES relying on Zitadel's own SMTP delivery
// for signup verification mail — Task 5 only sends; Task 6 wires it into the signup flow.
//
// CONTRACT (Task 6 depends on this): sendVerificationMail NEVER throws. Task 6 calls it from
// inside signup, which must satisfy G7 enumeration safety — the signup response has to stay
// byte-identical (status, body, Set-Cookie, timing class) across fresh / existing-verified /
// existing-unverified. A thrown error here would change that response and turn a delivery
// failure into an enumeration oracle. Every failure path — VERIFICATION_MAIL_URL unset,
// connection refused, timeout, non-2xx response, a missing/unreadable client-cert file, anything
// else — resolves `false`; the caller decides how to react. Unset VERIFICATION_MAIL_URL disables
// delivery outright: signup still succeeds and the user recovers via resend, the same posture as
// resendIfSquatted in signup.service.ts.
//
// SECURITY: `code` is a bearer credential. It is sent ONLY in the POST body, over mTLS. It MUST
// NEVER appear in a thrown error, a caught-error message, or a log line. logAuthEvent below is
// only ever given `userId` + a bounded reason/status; the raw error and the request payload are
// never interpolated into it.
//
// `.server.ts` suffix: this module imports node:http/node:https and reads env.server — it must
// never reach the browser bundle. The framework enforces that boundary from the filename alone.
import { env } from '@/server/infra/env.server';
import { logAuthEvent } from '@/server/observability';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';

export interface SendVerificationMailInput {
  userId: string;
  code: string;
  returnTo: string;
}

// Bounded so a routable-but-unresponsive host (as opposed to an immediately-refused connection)
// can't hang the caller indefinitely. Short (in-cluster POST, not a public internet hop) — a
// generous timeout here widens the fresh-vs-existing-account timing gap G7 enumeration safety
// already tolerates during a webhook outage, so this stays tight rather than defensively long.
const REQUEST_TIMEOUT_MS = 2000;

/**
 * POSTs `{ userId, code, returnTo }` as JSON to VERIFICATION_MAIL_URL. Resolves `true` only on a
 * 2xx response. Resolves `false` — NEVER throws — for every other outcome, including delivery
 * being disabled in this environment (VERIFICATION_MAIL_URL unset).
 */
export async function sendVerificationMail(input: SendVerificationMailInput): Promise<boolean> {
  const url = env.VERIFICATION_MAIL_URL;
  if (!url) return false; // delivery disabled in this environment — silent, not an error

  try {
    const status = await postJson(url, input);
    const ok = status >= 200 && status < 300;
    logAuthEvent(
      ok ? 'signup_verification_mail_sent' : 'signup_verification_mail_failed',
      ok ? 'success' : 'failure',
      { userId: input.userId, status }
    );
    return ok;
  } catch (error) {
    // Never interpolate `error` (message/stack) or `input` here — either could theoretically
    // carry `code` (e.g. a client/socket error library echoing back request context).
    // `error.name` is a bounded constructor-name string (Error, TypeError, AggregateError, …).
    logAuthEvent('signup_verification_mail_failed', 'failure', {
      userId: input.userId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return false;
  }
}

/**
 * Low-level POST. mTLS is applied via a `https.Agent` carrying the client cert/key/CA read from
 * the files at VERIFICATION_MAIL_CLIENT_CERT_FILE / _CLIENT_KEY_FILE / _CA_CERT_FILE — relevant
 * only for `https:` targets, which is every real deployment (VERIFICATION_MAIL_URL is always
 * deployed as an https URL). A plain `http:` target — used only by the node-spec test harness,
 * never in production — skips the Agent entirely, which keeps the local test listener free of
 * self-signed certificate plumbing without weakening the real mTLS path in any way.
 *
 * The files are read fresh on EVERY call, never cached — that is the point of the mounted-Secret-
 * volume approach this replaces env-PEM with: a cached read would reintroduce the same
 * expires-in-place bug (env from secretKeyRef is set once at pod creation and never refreshes) that
 * the volume mount exists to fix. A missing/unreadable file throws synchronously inside this
 * executor, which the Promise constructor turns into a rejection; `sendVerificationMail`'s outer
 * try/catch catches that rejection and resolves `false`, same as every other failure — see the
 * CONTRACT note at the top of this file.
 */
function postJson(rawUrl: string, body: SendVerificationMailInput): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(rawUrl);
    const payload = JSON.stringify(body);
    const isHttps = target.protocol === 'https:';
    const agent = isHttps
      ? new https.Agent({
          cert: fs.readFileSync(env.VERIFICATION_MAIL_CLIENT_CERT_FILE ?? '', 'utf-8'),
          key: fs.readFileSync(env.VERIFICATION_MAIL_CLIENT_KEY_FILE ?? '', 'utf-8'),
          ca: fs.readFileSync(env.VERIFICATION_MAIL_CA_CERT_FILE ?? '', 'utf-8'),
        })
      : undefined;

    const request = (isHttps ? https : http).request(
      target,
      {
        method: 'POST',
        agent,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume(); // drain — the response body is irrelevant to the boolean contract
        resolve(res.statusCode ?? 0);
      }
    );
    request.on('timeout', () => request.destroy(new Error('verification-mail request timed out')));
    request.on('error', reject);
    request.end(payload);
  });
}
