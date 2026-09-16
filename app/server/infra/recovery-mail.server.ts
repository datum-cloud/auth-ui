// app/server/infra/recovery-mail.server.ts
//
// Server-only mTLS client to the zitadel-provider authn-webhook that creates a milo `Email`
// resource carrying a passkey registration code — the self-serve half of Phase C recovery. Same
// host and same client material as verification mail, a different path.
//
// THE WEBHOOK MINTS THE CODE, NOT US (contract v2, zitadel-provider #138). auth-ui asks for a
// recovery mail and is told which code was minted; it never sees the code itself. That inversion
// is the point: the raw code now travels only into the Email body and the mail link's URL
// FRAGMENT, so it is never in an auth-ui request, an access log, or a Referer header. The request
// carries `{ userId, returnTo, requestedBy }` and the webhook answers 200 `{ "codeId": "<id>" }`;
// sending `codeId` or `code` in the request is a 400 by that contract, which is why this input
// type has no field for either.
//
// CONTRACT (requestRecovery depends on this): sendRecoveryMail NEVER throws. It is called from
// inside the /recover request decision, which must satisfy G7 enumeration safety — the response
// has to stay byte-identical (status, body, Set-Cookie length, timing class) across fresh /
// verified / unverified / unknown / org-refused / rate-limited. A thrown error here would change
// that response and turn a delivery failure into an enumeration oracle. Every failure path —
// RECOVERY_MAIL_URL unset, connection refused, timeout, non-2xx, an unreadable client-cert file,
// a 200 whose body does not name a usable codeId, anything else — resolves `null`. The caller does
// NOT vary its response on the result: the ticket is issued either way, because a user whose mail
// failed must not be distinguishable from one whose mail arrived.
//
// SECURITY: `codeId` is not secret on its own and MAY be logged — it identifies which code
// without being usable as one. The RESPONSE BODY as a whole is not: a misconfigured or
// compromised webhook could put anything in it, the raw code included, so it is parsed and then
// discarded — never logged, never attached to an error, never echoed to the caller. The audit
// calls below are only ever given `userId` + a bounded reason/status.
//
// `.server.ts` suffix: this module reads env.server and drives node:http/node:https through the
// shared transport — it must never reach the browser bundle.
import { env } from '@/server/infra/env.server';
import { postMailWebhook } from '@/server/infra/mail-webhook.server';
import { logAuthEvent } from '@/server/observability';

export interface SendRecoveryMailInput {
  userId: string;
  returnTo: string;
  /** Closed vocabulary shared with zitadel-provider's webhook, which uses it to pick between the
   *  two configured templates. auth-ui's self-serve door only ever sends 'self'; the support door
   *  is the admin backstop's REST resource, not this client. A value other than 'self' is a 400. */
  requestedBy: 'self';
}

/** The only thing we accept out of the response. Anything else about the body is ignored. */
function parseCodeId(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    // Reject arrays and null alongside primitives: `typeof null === 'object'` and an array would
    // otherwise index straight through to `undefined`, which reads the same as a real refusal but
    // for the wrong reason.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const codeId = (parsed as { codeId?: unknown }).codeId;
    return typeof codeId === 'string' && codeId !== '' ? codeId : null;
  } catch {
    // Not JSON at all — an HTML error page from a proxy, an empty body, a truncated one.
    return null;
  }
}

/**
 * POSTs `{ userId, returnTo, requestedBy }` as JSON to RECOVERY_MAIL_URL and resolves the
 * `codeId` the webhook minted. Resolves `null` — NEVER throws — for every other outcome,
 * including delivery being disabled in this environment (RECOVERY_MAIL_URL unset), a non-2xx
 * status (the webhook answers 429 when its per-user cooldown refuses), and a 2xx whose body does
 * not name a usable codeId.
 *
 * The STATUS decides first and the body is only read after: a failing webhook that echoed a
 * codeId-shaped diagnostic back must not be mistaken for a mail that was actually sent.
 */
export async function sendRecoveryMail(input: SendRecoveryMailInput): Promise<string | null> {
  const url = env.RECOVERY_MAIL_URL;
  if (!url) return null; // delivery disabled in this environment — silent, not an error

  try {
    const { status, body } = await postMailWebhook(url, input);
    const codeId = status >= 200 && status < 300 ? parseCodeId(body) : null;
    logAuthEvent(
      codeId ? 'recovery_mail_sent' : 'recovery_mail_failed',
      codeId ? 'success' : 'failure',
      {
        userId: input.userId,
        status,
      }
    );
    return codeId;
  } catch (error) {
    // Never interpolate `error` (message/stack), `input` or the response body here — any of them
    // could theoretically carry the code (a socket library echoing back request context, a
    // webhook misconfigured to return what it minted).
    // `error.name` is a bounded constructor-name string (Error, TypeError, AggregateError, …).
    logAuthEvent('recovery_mail_failed', 'failure', {
      userId: input.userId,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}
