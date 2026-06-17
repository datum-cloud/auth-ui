import { decideAuthorize } from '@/flows/authorize-decision';
import type { AuthProvider } from '@/providers/auth-provider';
import { ProviderError } from '@/providers/types';
import { type AuthErrorCode, providerErrorCode } from '@/routes/_shared/auth-error';
import { providerForRequest } from '@/server/auth-context.server';
import { logAuthEvent } from '@/server/observability';
// ADAPTATION (import drift fix): readSessions lives in @/session/cookie (the route-layer
// one-stop import); mostRecent/byId are re-exported from there too (cookie.ts re-exports
// them from session.ts). The locked plan listed them from @/session/session — both work,
// but @/session/cookie is the canonical route-layer import (matches login.password.tsx).
import {
  readSessions,
  mostRecent,
  byId,
  removeSession,
  serializeSessions,
  type SessionEntry,
} from '@/session/cookie';
import { redirect, type LoaderFunctionArgs } from 'react-router';

// AuthRequest resolution failures map a ProviderError code → a tamper-proof AuthErrorCode
// (providerErrorCode, in routes/_shared/auth-error). The friendly copy now lives in the fixed
// code→message table, so the URL only ever carries `?code=` (see redirectToError below).

// requestId prefixes the loader understands. `oidc_` (Phase 1) and `saml_` (Phase 6 Task 8)
// are fully implemented; `device_` is normalized but routes to a separate ceremony.
const REQUEST_PREFIXES = ['oidc_', 'saml_', 'device_'] as const;

// Error codes that mean the session is CONFIRMED DEAD (terminated/invalid) rather than a
// transient provider hiccup. After RP-initiated logout (cloud-portal revokes tokens + ends
// the OIDC session) auth-ui's `sessions` cookie can outlive the Zitadel session; reusing that
// stale {id, token} in createCallback yields FAILED_PRECONDITION → ALREADY_DONE → /id/error.
// NOT_FOUND / PERMISSION_DENIED on getSession is that dead-session signal — anything else
// (UNAVAILABLE, DEADLINE_EXCEEDED, UNKNOWN, …) is transient and MUST NOT log the user out.
const DEAD_SESSION_CODES: ReadonlySet<ProviderError['code']> = new Set([
  'NOT_FOUND',
  'PERMISSION_DENIED',
]);

/**
 * Validate that a cookie session is still alive before reusing it in createCallback.
 *
 * Returns a Response (caller must return it immediately) for the two non-alive outcomes, and
 * `null` only when the session is ALIVE (caller proceeds to createCallback exactly as before):
 *
 *   • CONFIRMED DEAD — getSession → null, or a ProviderError with a DEAD_SESSION_CODES code:
 *     drop the stale entry from the cookie and re-prompt /login (self-heal; mirrors the SAML
 *     no-session bootstrap), emitting a DISTINCT `session_stale` event so the heal is traceable
 *     and never mistaken for a genuine error. (The post-logout stale-cookie case.)
 *
 *   • TRANSIENT / UNKNOWN — any OTHER ProviderError code (UNAVAILABLE, DEADLINE_EXCEEDED, …):
 *     do NOT log the user out. Surface the loader's existing friendly error page (the same path
 *     a transient getAuthRequest failure already takes — there is no app ErrorBoundary, so a raw
 *     re-throw would degrade to an unhelpful 500) and log an `oidc_callback` failure WITH the
 *     code so the transient is diagnosable. A Zitadel hiccup must never silently re-login a
 *     valid user, and must never be swallowed.
 *
 * Distinguishing dead vs transient by the error code is the critical precision that prevents
 * introducing a new bug (logging out a valid user on a transient blip).
 */
async function healIfSessionDead(
  provider: AuthProvider,
  url: URL,
  list: SessionEntry[],
  entry: SessionEntry,
  requestId: string,
  rawId: string
): Promise<Response | null> {
  let alive: Awaited<ReturnType<AuthProvider['getSession']>>;
  try {
    alive = await provider.getSession(entry.id, entry.token);
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : undefined;
    // Distinguish dead vs transient by error code — this precision is the whole point.
    if (code && DEAD_SESSION_CODES.has(code)) {
      return healStaleEntry(list, entry, requestId, rawId);
    }
    // Transient/unknown: surface the friendly error path; NEVER self-heal, NEVER swallow.
    logAuthEvent('oidc_callback', 'failure', {
      requestId: rawId,
      sessionId: entry.id,
      code: code ?? 'UNKNOWN',
      stage: 'liveness_check',
    });
    return redirectToError(url, providerErrorCode(code));
  }
  if (!alive) return healStaleEntry(list, entry, requestId, rawId); // confirmed dead
  return null; // alive → proceed to createCallback
}

/** Drop the stale entry, re-prompt /login, and emit a traceable session_stale event. */
async function healStaleEntry(
  list: SessionEntry[],
  entry: SessionEntry,
  requestId: string,
  rawId: string
): Promise<Response> {
  logAuthEvent('session_stale', 'success', { requestId: rawId, sessionId: entry.id });
  const pruned = removeSession(list, entry.id);
  return redirect(`/login?requestId=${encodeURIComponent(requestId)}`, {
    headers: { 'set-cookie': await serializeSessions(pruned) },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);
  // Normalize all three request kinds into one prefixed requestId (CCD-7 / BLK-02):
  //   ?authRequest=<id>  → oidc_<id>   (implemented in Phase 1)
  //   ?samlRequest=<id>  → saml_<id>   (branch implemented in Phase 5)
  //   (device flow lands a `device_<id>` requestId in Phase 5; the allowlist already accepts it)
  const oidcRequestId = url.searchParams.get('authRequest');
  const samlRequestId = url.searchParams.get('samlRequest');
  const threaded = url.searchParams.get('requestId');
  const requestId =
    threaded ??
    (oidcRequestId ? `oidc_${oidcRequestId}` : undefined) ??
    (samlRequestId ? `saml_${samlRequestId}` : undefined);
  const sessionId = url.searchParams.get('sessionId') ?? undefined;

  // Broadened guard/validator: accept oidc_ | saml_ | device_ (CCD-7). Anything else is rejected
  // before use — this is also the open-redirect guard (only ever follow Zitadel-issued requests).
  if (!requestId || !REQUEST_PREFIXES.some((p) => requestId.startsWith(p))) {
    return redirectToError(url, 'no_request');
  }

  // ── SAML branch (Phase 6 Task 8; stateless rebuild) ───────────────────────────────────────────
  // Handles ?samlRequest=<id> → requestId = saml_<id>.
  //
  // STATELESS HAND-OFF (replicas-safe): /authorize only validates the request and gates on a
  // session, then redirects to the BFF /sso/saml-post handler — which generates the SAML response
  // itself. The assertion (~15 KB) is never stashed in a cookie or a process-local store, so the
  // /authorize write and the /sso/saml-post read no longer share cross-request state and can land
  // on different pods at replicas:2 without breaking the flow. Security bonus: the assertion never
  // crosses a request boundary.
  if (requestId.startsWith('saml_')) {
    const samlId = requestId.slice('saml_'.length);
    try {
      // Fail fast on an expired/invalid request before bootstrapping the ceremony. The BFF
      // handler re-validates defensively, but resolving here keeps the friendly providerErrorCode
      // UX (the BFF can only emit a generic error page) for the common expired-link case.
      await provider.getAuthRequest('saml', samlId);
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : undefined;
      logAuthEvent('authrequest_resolve', 'failure', { requestId: samlId, code });
      return redirectToError(url, providerErrorCode(code));
    }

    const list = await readSessions(request);
    const session = mostRecent(list);
    if (!session) {
      // No active session — bootstrap straight into the identifier screen, threading the
      // requestId so the ceremony can resume and finish the SAML response (mirrors the OIDC
      // no-session path via decideAuthorize → /login). Routing to /accounts here dead-ended
      // the flow: its empty-state "Add an account" link drops the requestId, so an
      // SP-initiated SAML login could never complete headlessly.
      return redirect(`/login?requestId=${encodeURIComponent(requestId)}`);
    }

    // Session present → hand off to the BFF, which generates + delivers the response (both
    // bindings). /sso/saml-post is a Hono route registered under the /id basename, so we redirect
    // to the basename-relative path and React Router prepends /id automatically. No cookie, no
    // store — just the request id.
    return redirect(`/sso/saml-post?id=${encodeURIComponent(samlId)}`);
  }

  // ── device_ branch (post-login return-to-consent) ────────────────────────────────────────────
  // device_<userCode> arrives here when /device/authorize sent an unauthenticated user through
  // the login ceremony (/login?requestId=device_…). The ceremony threads it back — directly from
  // login.password when fully authenticated, or via /signed-in for the MFA-setup-skip path — and
  // we hand control back to the consent screen, which re-resolves the device auth by user code.
  // (The user code is the stable handle: the adapter returns a fresh opaque id per getDeviceAuth.)
  if (requestId.startsWith('device_')) {
    const userCode = requestId.slice('device_'.length);
    const params = new URLSearchParams({ user_code: userCode });
    return redirect(`/device/authorize?${params}`);
  }

  const rawId = requestId.replace('oidc_', '');

  let authRequest;
  try {
    authRequest = await provider.getAuthRequest('oidc', rawId);
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : undefined;
    // ADAPTATION (audit events §C(f)): log resolution failure before redirecting.
    logAuthEvent('authrequest_resolve', 'failure', { requestId: rawId, code });
    return redirectToError(url, providerErrorCode(code));
  }

  const list = await readSessions(request);

  // explicit sessionId hand-back from /login/password → finish the callback
  if (sessionId) {
    const entry = byId(list, sessionId);
    if (entry) {
      // Validate liveness BEFORE reuse: a stale post-logout cookie self-heals to /login here
      // instead of reaching createCallback on a terminated session (→ ALREADY_DONE → /error).
      const healed = await healIfSessionDead(provider, url, list, entry, requestId, rawId);
      if (healed) return healed;
      try {
        const { callbackUrl } = await provider.createCallback(rawId, {
          id: entry.id,
          token: entry.token,
        });
        // ADAPTATION (audit events §C(f)): emit success event after createCallback.
        logAuthEvent('oidc_callback', 'success', { requestId: rawId, sessionId: entry.id });
        return redirect(callbackUrl);
      } catch (err) {
        logAuthEvent('oidc_callback', 'failure', {
          requestId: rawId,
          sessionId: entry.id,
          code: err instanceof ProviderError ? err.code : 'UNKNOWN',
        });
        return redirectToError(url, 'signin_failed');
      }
    }
  }

  const recent = mostRecent(list);
  const decision = decideAuthorize({
    authRequest,
    hasSessions: list.length > 0,
    validSessionId: recent?.id,
  });

  if (decision.target === 'callback') {
    const entry = byId(list, decision.params?.sessionId ?? '');
    if (!entry) return redirectToError(url, 'no_session');
    // Validate liveness BEFORE reuse (same self-heal as the explicit-sessionId path above).
    const healed = await healIfSessionDead(provider, url, list, entry, requestId, rawId);
    if (healed) return healed;
    try {
      const { callbackUrl } = await provider.createCallback(rawId, {
        id: entry.id,
        token: entry.token,
      });
      // ADAPTATION (audit events §C(f)): emit success event after createCallback.
      logAuthEvent('oidc_callback', 'success', { requestId: rawId, sessionId: entry.id });
      return redirect(callbackUrl);
    } catch (err) {
      logAuthEvent('oidc_callback', 'failure', {
        requestId: rawId,
        sessionId: entry.id,
        code: err instanceof ProviderError ? err.code : 'UNKNOWN',
      });
      return redirectToError(url, 'signin_failed');
    }
  }
  if (decision.target === 'error') {
    if (decision.error === 'NO_ACTIVE_SESSION') {
      return new Response(JSON.stringify({ error: 'No active session found' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return redirectToError(url, 'signin_failed');
  }

  // bootstrap into a screen, threading requestId
  const params = new URLSearchParams({ requestId });
  Object.entries(decision.params ?? {}).forEach(([k, v]) => params.set(k, v));
  return redirect(`${decision.target}?${params}`);
}

// Redirect to /id/error with a tamper-proof code (the page maps it to a fixed message). The path
// is basename-relative — React Router prepends /id. Only the known code is ever in the URL, so the
// message can no longer be rewritten by the user via free-text query params.
function redirectToError(url: URL, code: AuthErrorCode) {
  const target = new URL('/error', url.origin);
  target.searchParams.set('code', code);
  return redirect(target.pathname + target.search);
}

export default function Authorize() {
  return null;
}
