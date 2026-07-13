import {
  readSessions,
  mostRecent,
  removeSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { ProviderError, type SamlResponse } from '@/modules/auth/types';
import { resolveSamlBinding } from '@/resources/sso/saml-binding';
import { providerForRequest } from '@/server/auth-context.server';
import { logAuthEvent } from '@/server/observability';
import type { AuthErrorCode } from '@/utils/errors/auth-error';
import type { Context } from 'hono';

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Pure: auto-submitting POST form. Values are HTML-attribute-escaped (security fix over the fork).
 * The auto-submit runs from a nonce'd <script> (NOT an inline onload= handler) so it
 * survives the prod nonce-based CSP (spec §9: nonce-based + strict-dynamic).
 */
export function renderSamlPostForm(
  url: string,
  fields: Record<string, string>,
  nonce: string
): string {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(v)}" />`)
    .join('\n      ');
  return `<!doctype html><html><body>
    <form action="${escapeAttr(url)}" method="post">
      ${inputs}
      <noscript><button type="submit">Continue</button></noscript>
    </form>
    <script nonce="${escapeAttr(nonce)}">document.forms[0].submit()</script>
  </body></html>`;
}

/**
 * Build the /id/error redirect path the RR error UX uses, mirroring authorize.tsx's
 * redirectToError. The URL carries only a tamper-proof code (the page maps it to a fixed message);
 * no user-controlled free text. Hono is NOT under RR basename auto-prefixing, so the full
 * /id/error path is built explicitly here.
 */
function errorRedirectPath(code: AuthErrorCode): string {
  const params = new URLSearchParams({ code });
  return `/id/error?${params}`;
}

// Shared protocol guard — both redirect and POST bindings go through
// this. The ACS url comes from the adapter, not from the client, but a malformed or hostile
// adapter value (javascript:, relative path, data:) must never reach the browser. Throws on
// failure; callers map the throw to an error response. Exported for unit testing.
export function assertHttpUrl(url: string): void {
  const parsed = new URL(url); // throws on non-parseable
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Invalid url: must be http or https');
  }
}

/**
 * Handler for the /id/sso/saml-post BFF route.
 *
 * STATELESS (replicas-safe): the SAML response is generated HERE, inside this single request —
 * /authorize only validates + session-gates, then redirects here with ?id=. Nothing crosses a
 * request boundary, so there is no process-local store to desync at replicas:2.
 *
 * Security invariants:
 *  - The ACS url comes ONLY from the freshly generated, adapter-derived response (bound.url),
 *    NEVER from a client query/cookie — a tampered query cannot redirect the assertion.
 *  - No anonymous assertion generation: a session is required before createSamlResponse runs.
 *  - The post-binding form is attribute-escaped and the auto-submit script is nonce'd.
 */
export async function samlPostHandler(c: Context): Promise<Response> {
  const id = c.req.query('id');
  if (!id) return c.text('Missing id', 400);

  // Session gate (defence-in-depth): /authorize normally bootstraps the session before
  // redirecting here, but a directly-hit handler must NEVER generate an assertion anonymously.
  // Hono is not under RR basename auto-prefixing — use the full /id/... path in the redirect.
  const list = await readSessions(c.req.raw);
  const session = mostRecent(list);
  if (!session) {
    return c.redirect('/id/login?requestId=saml_' + encodeURIComponent(id));
  }

  const provider = providerForRequest(c.req.raw);

  // Stale-session self-heal — mirror authorize.tsx's healIfSessionDead.
  // After RP-initiated logout the sessions cookie can outlive the Zitadel session; a dead
  // {id, token} must never produce an assertion. Re-prompt /login if the session is gone.
  // Only NOT_FOUND / PERMISSION_DENIED are treated as definitively dead (same DEAD_SESSION_CODES
  // as authorize.tsx); transient errors (UNAVAILABLE, …) fall through to let the SAML generation
  // fail normally — we must not log a valid user out on a transient blip.
  try {
    const alive = await provider.getSession(session.id, session.token);
    if (!alive) {
      // confirmed dead (null return)
      logAuthEvent('session_stale', 'success', { requestId: id, sessionId: session.id });
      const pruned = removeSession(list, session.id);
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/id/login?requestId=saml_' + encodeURIComponent(id),
          'set-cookie': await serializeSessions(pruned),
        },
      });
    }
  } catch (err) {
    if (
      err instanceof ProviderError &&
      (err.code === 'NOT_FOUND' || err.code === 'PERMISSION_DENIED')
    ) {
      logAuthEvent('session_stale', 'success', { requestId: id, sessionId: session.id });
      const pruned = removeSession(list, session.id);
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/id/login?requestId=saml_' + encodeURIComponent(id),
          'set-cookie': await serializeSessions(pruned),
        },
      });
    }
    // transient error — fall through; let createSamlResponse/getAuthRequest surface it
  }

  // Re-resolve the request defensively — don't trust that /authorize validated it (this handler
  // is reachable directly). On failure, mirror /authorize's error UX via a coded /id/error.
  try {
    await provider.getAuthRequest('saml', id);
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : undefined;
    logAuthEvent('authrequest_resolve', 'failure', { requestId: id, code });
    return c.redirect(errorRedirectPath('request_expired'));
  }

  // Generate the SAML response from the validated session. ACS url + fields come ONLY from here.
  let samlRes: SamlResponse;
  try {
    samlRes = await provider.createSamlResponse(id, { id: session.id, token: session.token });
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : undefined;
    logAuthEvent('saml_response', 'failure', { requestId: id, code });
    return c.redirect(errorRedirectPath('saml_failed'));
  }

  const bound = resolveSamlBinding(samlRes);

  // Protocol-validate the ACS url before BOTH bindings (redirect and POST).
  // assertHttpUrl throws on non-http(s) protocols (javascript:, data:, relative paths, etc.).
  // Map a thrown error to a 400 so the caller can detect invalid-url vs a normal SAML error.
  try {
    assertHttpUrl(bound.url);
  } catch {
    logAuthEvent('saml_response', 'failure', { requestId: id, reason: 'invalid_url' });
    return c.text('Invalid url: must be http or https', 400);
  }

  if (bound.kind === 'redirect') {
    logAuthEvent('saml_response', 'success', { requestId: id, binding: 'redirect' });
    // Absolute SP URL — Hono won't prefix it.
    return c.redirect(bound.url);
  }

  // Fail closed: if nonce is missing the response would contain nonce="undefined" which
  // violates our CSP. Return 500 instead of emitting a broken/unsafe page.
  const nonce = c.get('secureHeadersNonce') as string | undefined;
  if (!nonce) return c.text('CSP nonce unavailable', 500);

  logAuthEvent('saml_response', 'success', { requestId: id, binding: 'post' });
  return c.html(renderSamlPostForm(bound.url, bound.fields, nonce));
}
