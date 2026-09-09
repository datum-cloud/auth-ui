// app/server/infra/mail-webhook.server.ts
//
// The one low-level mTLS POST both mail clients use. Extracted verbatim from
// verification-mail.server.ts's private `postJson` when recovery needed the same transport:
// two copies of a per-request cert read, a timeout reject and an isHttps rule would drift, and
// the drift would be silent — both callers swallow every failure by contract.
//
// This module is transport ONLY. It has no never-throws contract of its own: it REJECTS on a
// transport error, a timeout, or an unreadable cert file, and each caller's outer try/catch is
// what turns that into the `false` its own contract promises.
//
// SECURITY: `body` may carry a bearer credential (a verification code, a passkey registration
// code). It is serialized into the request and nothing else — never logged here, never attached
// to a rejection. Callers must not interpolate a rejected error's message either, since a socket
// library could echo request context back.
//
// `.server.ts` suffix: imports node:http/node:https and reads env.server — never in the browser
// bundle. The framework enforces that boundary from the filename alone.
import { env } from '@/server/infra/env.server';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';

// Bounds a routable-but-unresponsive host. 5s because the webhook creates a milo `Email` — a
// Kubernetes API write whose p99 under load passes 2s, and a drop costs a user their mail. No
// longer, because this blocks the response and widens the fresh-vs-squatted timing gap during an
// outage (the squatted path runs its resend THROUGH this send).
const REQUEST_TIMEOUT_MS = 5000;

/**
 * POSTs `body` as JSON to `rawUrl` and resolves the response status. mTLS is applied via a
 * `https.Agent` carrying the client cert/key/CA read from the files at
 * VERIFICATION_MAIL_CLIENT_CERT_FILE / _CLIENT_KEY_FILE / _CA_CERT_FILE — relevant only for
 * `https:` targets, which is every real deployment. Both webhook paths live on the same host and
 * so share one set of client material. A plain `http:` target — the node-spec test harness only,
 * never production — skips the Agent entirely, which keeps the local test listener free of
 * self-signed certificate plumbing without weakening the real mTLS path in any way.
 *
 * The files are read fresh on EVERY call, never cached — that is the point of the mounted-Secret-
 * volume approach this replaces env-PEM with: a cached read would reintroduce the same
 * expires-in-place bug (env from secretKeyRef is set once at pod creation and never refreshes)
 * that the volume mount exists to fix. A missing/unreadable file throws synchronously inside this
 * executor, which the Promise constructor turns into a rejection for the caller to absorb.
 */
export function postMailWebhook(rawUrl: string, body: unknown): Promise<number> {
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
        res.resume(); // drain — the response body is irrelevant to the status contract
        resolve(res.statusCode ?? 0);
      }
    );
    // Reject here, not via destroy(err): under Bun that emits no 'error', so the handler below
    // never fired and this promise stayed pending forever — the caller awaits it.
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('mail webhook request timed out'));
    });
    request.on('error', reject);
    request.end(payload);
  });
}
