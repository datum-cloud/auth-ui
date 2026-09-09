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
import { postMailWebhook } from '@/server/infra/mail-webhook.server';
import { logAuthEvent } from '@/server/observability';

export interface SendVerificationMailInput {
  userId: string;
  code: string;
  returnTo: string;
}

/**
 * POSTs `{ userId, code, returnTo }` as JSON to VERIFICATION_MAIL_URL via the shared mTLS
 * transport. Resolves `true` only on a 2xx response. Resolves `false` — NEVER throws — for every
 * other outcome, including delivery being disabled in this environment (URL unset), a transport
 * error, a timeout and an unreadable client-cert file: postMailWebhook rejects on all of those
 * and the catch below absorbs it.
 */
export async function sendVerificationMail(input: SendVerificationMailInput): Promise<boolean> {
  const url = env.VERIFICATION_MAIL_URL;
  if (!url) return false; // delivery disabled in this environment — silent, not an error

  try {
    const status = await postMailWebhook(url, input);
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
