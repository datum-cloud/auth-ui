// app/server/infra/recovery-mail.server.ts
//
// Server-only mTLS client to the zitadel-provider authn-webhook that creates a milo `Email`
// resource carrying a passkey registration code — the self-serve half of Phase C recovery. Same
// host and same client material as verification mail, a different path.
//
// CONTRACT (requestRecovery depends on this): sendRecoveryMail NEVER throws. It is called from
// inside the /recover request decision, which must satisfy G7 enumeration safety — the response
// has to stay byte-identical (status, body, Set-Cookie length, timing class) across fresh /
// verified / unverified / unknown / org-refused / rate-limited. A thrown error here would change
// that response and turn a delivery failure into an enumeration oracle. Every failure path —
// RECOVERY_MAIL_URL unset, connection refused, timeout, non-2xx, an unreadable client-cert file,
// anything else — resolves `false`. The caller does NOT branch on the result: the sealed ticket
// is issued either way, because a user whose mail failed must not be distinguishable from one
// whose mail arrived.
//
// SECURITY: `code` is a bearer credential. It is sent ONLY in the POST body, over mTLS. It MUST
// NEVER appear in a thrown error, a caught-error message, or a log line. `codeId` is not secret
// on its own and MAY be logged — it identifies which code without being usable as one. The audit
// calls below are only ever given `userId` + a bounded reason/status.
//
// `.server.ts` suffix: this module reads env.server and drives node:http/node:https through the
// shared transport — it must never reach the browser bundle.
import { env } from '@/server/infra/env.server';
import { postMailWebhook } from '@/server/infra/mail-webhook.server';
import { logAuthEvent } from '@/server/observability';

export interface SendRecoveryMailInput {
  userId: string;
  codeId: string;
  code: string;
  returnTo: string;
  /** Closed vocabulary shared with zitadel-provider's webhook, which uses it to pick between the
   *  two configured templates. auth-ui's self-serve door only ever sends 'self'; the support door
   *  is the admin backstop's REST resource, not this client. */
  requestedBy: 'self';
}

/**
 * POSTs `{ userId, codeId, code, returnTo, requestedBy }` as JSON to RECOVERY_MAIL_URL. Resolves
 * `true` only on a 2xx response. Resolves `false` — NEVER throws — for every other outcome,
 * including delivery being disabled in this environment (RECOVERY_MAIL_URL unset).
 */
export async function sendRecoveryMail(input: SendRecoveryMailInput): Promise<boolean> {
  const url = env.RECOVERY_MAIL_URL;
  if (!url) return false; // delivery disabled in this environment — silent, not an error

  try {
    const status = await postMailWebhook(url, input);
    const ok = status >= 200 && status < 300;
    logAuthEvent(ok ? 'recovery_mail_sent' : 'recovery_mail_failed', ok ? 'success' : 'failure', {
      userId: input.userId,
      status,
    });
    return ok;
  } catch (error) {
    // Never interpolate `error` (message/stack) or `input` here — either could theoretically
    // carry `code` (e.g. a client/socket error library echoing back request context).
    // `error.name` is a bounded constructor-name string (Error, TypeError, AggregateError, …).
    logAuthEvent('recovery_mail_failed', 'failure', {
      userId: input.userId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return false;
  }
}
