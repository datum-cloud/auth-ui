// app/resources/authorize/authorize.service.ts
//
// Pass 2 extraction: the /authorize loader BUSINESS logic — request-kind
// normalization (oidc_/saml_/device_), the open-redirect guard, the three branch
// pipelines (SAML stateless hand-off, device return-to-consent, OIDC callback),
// stale-cookie liveness self-heal, createCallback dispatch, and ProviderError →
// AuthErrorCode mapping. React rendering and the final Response construction stay
// thin in the route; the service describes WHAT to do via a typed `AuthorizeOutcome`
// and a pure `outcomeToResponse` translator that turns it into the redirect/JSON
// Response the route returns verbatim.
//
// The seed flow `authorize-decision.ts` (decideAuthorize / deriveOrganizationFromScopes)
// is re-exported through the barrel; the service builds the orchestration around it.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import {
  readSessions,
  mostRecent,
  byId,
  removeSession,
  serializeSessions,
  tsMs,
  type SessionEntry,
} from '@/modules/auth/session/cookie';
import { ProviderError, type Session } from '@/modules/auth/types';
import {
  decideAuthorize,
  deriveOrganizationFromScopes,
} from '@/resources/authorize/authorize-decision';
import { primaryFresh } from '@/resources/shared/lifetimes';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { logAuthEvent } from '@/server/observability';
import { realSleep, type Sleep } from '@/server/timing';
import { type AuthErrorCode, providerErrorCode } from '@/utils/errors/auth-error';
import { redirect } from 'react-router';

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

// ── read-after-write retry (Zitadel eventual consistency) ───────────────────────
//
// A session THIS request just created (e.g. the post-register /authorize handback, which
// redirects straight back here with the brand-new session id) can transiently 404 on
// getSession if the read lands on a replica that hasn't caught up with the write yet. Without
// this, healIfSessionDead below would self-heal a perfectly good, just-minted session straight
// to /login on nothing but replication lag.
//
// SCOPE — this retry is intentionally narrow and must stay that way:
//   • It only ever fires for a DEAD_SESSION_CODES code (NOT_FOUND/PERMISSION_DENIED) — never
//     for transient/unknown codes, which already skip self-heal entirely (see healIfSessionDead).
//   • It only fires when the cookie entry is FRESH (creationTs within RETRY_FRESHNESS_WINDOW_MS
//     of `nowMs`). creationTs is signed into the cookie by US at session-creation time — it is
//     NOT attacker-controlled, so an old/stale/forged entry can never masquerade as fresh to buy
//     itself a retry. This preserves the existing anti-forgery guarantee: a stale post-logout
//     cookie (or a genuinely forged sessionId) still self-heals to /login on the FIRST dead
//     response, with zero added latency or leniency.
//   • It retries a BOUNDED number of times (RETRY_BACKOFFS_MS, ~2.8s total max), stopping early
//     the moment a probe comes back alive or non-dead. If every attempt still comes back dead (or
//     errors), the function falls through to the exact same self-heal path as if there had been no
//     retry — the retry only ever *adds* patience for a fresh session, never leniency.
const RETRY_FRESHNESS_WINDOW_MS = 5000; // 5s — covers redirect latency + replica lag, nothing more
// Increasing backoffs between fresh-session liveness re-probes (~2.8s total max). A single short
// retry loses the race when a replica lags >1 read cycle; a bounded poll rides out the write→read
// replication for a session we KNOW we just created. Only ever applied to a fresh entry.
const RETRY_BACKOFFS_MS = [300, 500, 800, 1200] as const;

/** True when `entry` was created within RETRY_FRESHNESS_WINDOW_MS of `nowMs`. A malformed or
 *  missing creationTs (tsMs → NaN) is treated as NOT fresh — the safe default is the original,
 *  no-retry, immediate-self-heal behavior. */
function isFreshEntry(entry: SessionEntry, nowMs: number): boolean {
  const createdMs = tsMs(entry.creationTs);
  return Number.isFinite(createdMs) && nowMs - createdMs <= RETRY_FRESHNESS_WINDOW_MS;
}

/** One classified getSession attempt: alive session, confirmed-null, a DEAD_SESSION_CODES
 *  error, or any other (transient/unknown) error. Kept as an explicit discriminated result
 *  (rather than reusing shared mutable locals) so each branch below reads unambiguously —
 *  this is the anti-forgery self-heal path, worth the extra verbosity. */
type SessionProbe =
  | { kind: 'alive'; session: Session }
  | { kind: 'confirmed-dead' }
  | { kind: 'dead-code'; code: ProviderError['code'] }
  | { kind: 'transient'; code: ProviderError['code'] | undefined };

async function probeSession(provider: AuthProvider, entry: SessionEntry): Promise<SessionProbe> {
  try {
    const session = await provider.getSession(entry.id, entry.token);
    return session ? { kind: 'alive', session } : { kind: 'confirmed-dead' };
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : undefined;
    return code && DEAD_SESSION_CODES.has(code)
      ? { kind: 'dead-code', code }
      : { kind: 'transient', code };
  }
}

// createCallback codes that mean THIS session can no longer finalize THIS auth request, even
// though getSession reported it alive — a stale OIDC grant after RP-initiated logout (cloud-portal
// revokes the grant but auth-ui's `sessions` cookie outlives it). Re-authenticate instead of
// dead-ending on signin_failed: a fresh login mints a new session that completes the callback
// (confirmed in staging — this fails ONLY for old/stale sessions; a fresh login always works).
//
// SCOPED TO FAILED_PRECONDITION ONLY — the exact code observed in staging logs for the stale-grant
// failure. We deliberately do NOT self-heal on ALREADY_DONE: mappers.ts maps a code-9
// FailedPrecondition whose message matches /verified|already/i ("auth request already handled") to
// ALREADY_DONE, which is the DOUBLE-CALLBACK case — the SAME requestId re-submitted after it was
// already finalized (browser back+reload, duplicate tab, request race). There the session is still
// perfectly valid; pruning it and redirecting to /login (which re-threads the already-consumed
// requestId straight back to /authorize) would destroy a good session and risk a self-heal loop
// that keeps destroying each freshly-minted session. ALREADY_DONE therefore falls through to the
// conservative signin_failed path below with the session left intact — the pre-fix behavior for
// this case, which was strictly safe.
const DEAD_CALLBACK_CODES: ReadonlySet<ProviderError['code']> = new Set(['FAILED_PRECONDITION']);

// Freshness window for honoring a query-handed-back sessionId against a prompt=login request.
// The post-auth finalize redirect is near-immediate (the ceremony hands the just-authenticated
// session id straight back to /authorize), so 2 minutes generously covers redirect latency +
// clock skew while keeping forced re-auth meaningful — a STALE session id forged onto the URL
// can no longer satisfy prompt=login.
const FRESH_LOGIN_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

/**
 * The effective anti-forgery freshness window for a prompt=login hand-back. Defaults to the fixed
 * FRESH_LOGIN_WINDOW_MS (redirect-latency allowance), but an org configured with a STRICTER
 * `passwordCheckLifetimeMs` tightens it — so a strict org's policy is honored even on the gate's
 * pass path (which finalizes without re-running nextStep). It only ever tightens; an unset or
 * longer policy keeps the 2-minute window. Settings-read failure degrades to the fixed window.
 */
async function freshLoginWindowMs(
  provider: AuthProvider,
  entry: { organization?: string }
): Promise<number> {
  // Org-first: the session's org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
  const settings = await provider
    .getLoginSettings(entry.organization ?? (await resolveOrg(provider)))
    .catch(() => undefined);
  const lifetime = settings?.passwordCheckLifetimeMs;
  return typeof lifetime === 'number' && lifetime > 0
    ? Math.min(FRESH_LOGIN_WINDOW_MS, lifetime)
    : FRESH_LOGIN_WINDOW_MS;
}

/**
 * A typed description of what the /authorize loader resolved to. The route (and the
 * `outcomeToResponse` translator below) turn this into a redirect/JSON Response. Keeping
 * the cookie payload and status as data — not a constructed Response — makes the whole
 * pipeline testable at the service boundary while the route stays a thin translator.
 */
export type AuthorizeOutcome =
  | { kind: 'redirect'; location: string; setCookie?: string }
  | { kind: 'error-redirect'; code: AuthErrorCode }
  | { kind: 'json'; status: number; body: unknown };

// ── pure helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize all three request kinds into one prefixed requestId:
 *   ?authRequest=<id>  → oidc_<id>   (implemented in Phase 1)
 *   ?samlRequest=<id>  → saml_<id>   (branch implemented in Phase 5)
 *   ?requestId=<id>    → carried through verbatim (threaded back by the ceremony)
 *   (device flow lands a `device_<id>` requestId; the allowlist already accepts it)
 */
export function normalizeRequestId(url: URL): string | undefined {
  const oidcRequestId = url.searchParams.get('authRequest');
  const samlRequestId = url.searchParams.get('samlRequest');
  const threaded = url.searchParams.get('requestId');
  return (
    threaded ??
    (oidcRequestId ? `oidc_${oidcRequestId}` : undefined) ??
    (samlRequestId ? `saml_${samlRequestId}` : undefined)
  );
}

/**
 * Open-redirect guard / validator: accept oidc_ | saml_ | device_. Anything else is
 * rejected before use — only ever follow Zitadel-issued requests.
 */
export function isAllowedRequestId(requestId: string | undefined): requestId is string {
  return !!requestId && REQUEST_PREFIXES.some((p) => requestId.startsWith(p));
}

// ── outcome → Response translator (route-level wiring, kept pure) ───────────────

/**
 * Turn an AuthorizeOutcome into the Response the route returns. This is the ONLY place
 * redirect()/Response construction happens, so the route's loader is a two-liner. Service
 * tests run their assertions against the Response this produces — identical to what the
 * route returns — so every redirect/status/set-cookie assertion is preserved verbatim.
 */
export function outcomeToResponse(outcome: AuthorizeOutcome, url: URL): Response {
  switch (outcome.kind) {
    case 'redirect':
      return outcome.setCookie
        ? redirect(outcome.location, { headers: { 'set-cookie': outcome.setCookie } })
        : redirect(outcome.location);
    case 'error-redirect':
      return errorRedirect(url, outcome.code);
    case 'json':
      return new Response(JSON.stringify(outcome.body), {
        status: outcome.status,
        headers: { 'content-type': 'application/json' },
      });
  }
}

// Redirect to /id/error with a tamper-proof code (the page maps it to a fixed message). The path
// is basename-relative — React Router prepends /id. Only the known code is ever in the URL, so the
// message can no longer be rewritten by the user via free-text query params.
function errorRedirect(url: URL, code: AuthErrorCode): Response {
  const target = new URL('/error', url.origin);
  target.searchParams.set('code', code);
  return redirect(target.pathname + target.search);
}

// ── liveness self-heal ─────────────────────────────────────────────────────────

/**
 * Validate that a cookie session is still alive before reusing it in createCallback.
 *
 * Returns an AuthorizeOutcome (which carries a `kind`; caller must return it immediately) for the
 * two non-alive outcomes, and `{ session }` ONLY when the session is ALIVE (caller proceeds to the
 * freshness gate / createCallback). Callers discriminate on `'kind' in result`:
 *
 *   • CONFIRMED DEAD — getSession → null, or a ProviderError with a DEAD_SESSION_CODES code:
 *     drop the stale entry from the cookie and re-prompt /login (self-heal; mirrors the SAML
 *     no-session bootstrap), emitting a DISTINCT `session_stale` event so the heal is traceable
 *     and never mistaken for a genuine error. (The post-logout stale-cookie case.)
 *
 *     EXCEPT: a DEAD_SESSION_CODES code on a FRESH entry (isFreshEntry — see the retry block
 *     above) is re-probed with a BOUNDED increasing backoff (RETRY_BACKOFFS_MS, ~2.8s total max),
 *     stopping the instant it comes back alive, before this self-heal fires — see the
 *     RETRY_FRESHNESS_WINDOW_MS comment for the full scoping rationale (Zitadel read-after-write
 *     lag on a session THIS request just created). An old/stale/forged entry skips the retry
 *     entirely and self-heals immediately, exactly as before.
 *
 *   • TRANSIENT / UNKNOWN — any OTHER ProviderError code (UNAVAILABLE, DEADLINE_EXCEEDED, …):
 *     do NOT log the user out. Surface the loader's existing friendly error page and log an
 *     `oidc_callback` failure WITH the code so the transient is diagnosable. A Zitadel hiccup
 *     must never silently re-login a valid user, and must never be swallowed. Transient codes are
 *     NEVER retried here — only a DEAD_SESSION_CODES code on a fresh entry is.
 *
 *   • ALIVE — return the live `Session` so the caller can inspect its factors (the prompt=login
 *     freshness gate needs `factors.*.verifiedAt`) before reusing it in createCallback.
 *
 * Distinguishing dead vs transient by the error code is the critical precision that prevents
 * introducing a new bug (logging out a valid user on a transient blip).
 */
async function healIfSessionDead(
  provider: AuthProvider,
  list: SessionEntry[],
  entry: SessionEntry,
  requestId: string,
  rawId: string,
  nowMs: number,
  sleep: Sleep = realSleep
): Promise<AuthorizeOutcome | { session: Session }> {
  let probe = await probeSession(provider, entry);

  // RETRY-ON-FRESH: see the RETRY_FRESHNESS_WINDOW_MS block above for the full scoping rationale.
  // Zitadel's read-after-write lag on a session THIS request just created can exceed a single
  // retry, so poll with increasing backoff (RETRY_BACKOFFS_MS, ~2.8s total max) — but ONLY while
  // the entry is genuinely fresh (isFreshEntry, signed creationTs) AND the probe is still a dead
  // code. Every other case (already alive, confirmed-null, transient error, or a dead code on an
  // old/stale/forged entry) falls straight through to the original behavior with no wait.
  if (isFreshEntry(entry, nowMs)) {
    for (const backoff of RETRY_BACKOFFS_MS) {
      if (probe.kind !== 'dead-code') break;
      await sleep(backoff);
      probe = await probeSession(provider, entry);
    }
  }

  switch (probe.kind) {
    case 'alive':
      return { session: probe.session }; // caller proceeds to the freshness gate / createCallback
    case 'confirmed-dead':
    case 'dead-code':
      return healStaleEntry(list, entry, requestId, rawId);
    case 'transient':
      // Transient/unknown: surface the friendly error path; NEVER self-heal, NEVER swallow.
      logAuthEvent('oidc_callback', 'failure', {
        requestId: rawId,
        sessionId: entry.id,
        code: probe.code ?? 'UNKNOWN',
        stage: 'liveness_check',
      });
      return { kind: 'error-redirect', code: providerErrorCode(probe.code) };
  }
}

/** Drop the stale entry, re-prompt /login, and emit a traceable session_stale event. */
async function healStaleEntry(
  list: SessionEntry[],
  entry: SessionEntry,
  requestId: string,
  rawId: string
): Promise<AuthorizeOutcome> {
  logAuthEvent('session_stale', 'success', { requestId: rawId, sessionId: entry.id });
  const pruned = removeSession(list, entry.id);
  return {
    kind: 'redirect',
    location: `/login?requestId=${encodeURIComponent(requestId)}`,
    setCookie: await serializeSessions(pruned),
  };
}

/** Run createCallback for a resolved live session and map success/failure to an outcome. */
async function runCallback(
  provider: AuthProvider,
  rawId: string,
  entry: SessionEntry,
  list: SessionEntry[],
  requestId: string
): Promise<AuthorizeOutcome> {
  try {
    const { callbackUrl } = await provider.createCallback(rawId, {
      id: entry.id,
      token: entry.token,
    });
    // Emit the success audit event after createCallback.
    logAuthEvent('oidc_callback', 'success', { requestId: rawId, sessionId: entry.id });
    return { kind: 'redirect', location: callbackUrl };
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : undefined;
    logAuthEvent('oidc_callback', 'failure', {
      requestId: rawId,
      sessionId: entry.id,
      code: code ?? 'UNKNOWN',
    });
    // A DEAD_CALLBACK_CODES code means the session is a stale post-logout grant, not a genuine
    // failure: self-heal to /login (prune + re-auth) instead of dead-ending on signin_failed. Any
    // other code (transient/unknown) keeps the conservative existing behavior — surface the error
    // page rather than guessing that a re-login will help.
    if (code && DEAD_CALLBACK_CODES.has(code)) {
      return healStaleEntry(list, entry, requestId, rawId);
    }
    return { kind: 'error-redirect', code: 'signin_failed' };
  }
}

// ── branch pipelines ────────────────────────────────────────────────────────────

/**
 * SAML branch (Phase 6 Task 8; stateless rebuild). Handles ?samlRequest=<id> → saml_<id>.
 *
 * STATELESS HAND-OFF (replicas-safe): /authorize only validates the request and gates on a
 * session, then redirects to the BFF /sso/saml-post handler — which generates the SAML response
 * itself. The assertion (~15 KB) is never stashed in a cookie or a process-local store, so the
 * /authorize write and the /sso/saml-post read no longer share cross-request state.
 */
async function resolveSaml(
  provider: AuthProvider,
  request: Request,
  requestId: string
): Promise<AuthorizeOutcome> {
  const samlId = requestId.slice('saml_'.length);
  try {
    // Fail fast on an expired/invalid request before bootstrapping the ceremony. The BFF
    // handler re-validates defensively, but resolving here keeps the friendly providerErrorCode
    // UX (the BFF can only emit a generic error page) for the common expired-link case.
    await provider.getAuthRequest('saml', samlId);
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : undefined;
    logAuthEvent('authrequest_resolve', 'failure', { requestId: samlId, code });
    return { kind: 'error-redirect', code: providerErrorCode(code) };
  }

  const list = await readSessions(request);
  const session = mostRecent(list);
  if (!session) {
    // No active session — bootstrap straight into the identifier screen, threading the
    // requestId so the ceremony can resume and finish the SAML response (mirrors the OIDC
    // no-session path via decideAuthorize → /login). Routing to /accounts here dead-ended
    // the flow: its empty-state "Add an account" link drops the requestId.
    return { kind: 'redirect', location: `/login?requestId=${encodeURIComponent(requestId)}` };
  }

  // Session present → hand off to the BFF, which generates + delivers the response (both
  // bindings). /sso/saml-post is a Hono route registered under the /id basename, so we redirect
  // to the basename-relative path and React Router prepends /id automatically. No cookie, no
  // store — just the request id.
  return { kind: 'redirect', location: `/sso/saml-post?id=${encodeURIComponent(samlId)}` };
}

/**
 * device_ branch (post-login return-to-consent). device_<userCode> arrives here when
 * /device/authorize sent an unauthenticated user through the login ceremony. The ceremony
 * threads it back and we hand control back to the consent screen, which re-resolves the device
 * auth by user code. (The user code is the stable handle: the adapter returns a fresh opaque id
 * per getDeviceAuth.)
 */
function resolveDevice(requestId: string): AuthorizeOutcome {
  const userCode = requestId.slice('device_'.length);
  const params = new URLSearchParams({ user_code: userCode });
  return { kind: 'redirect', location: `/device/authorize?${params}` };
}

/** OIDC branch — resolve the auth request, gate on/heal the session, dispatch createCallback. */
async function resolveOidc(
  provider: AuthProvider,
  request: Request,
  url: URL,
  requestId: string,
  nowMs: number = Date.now()
): Promise<AuthorizeOutcome> {
  const rawId = requestId.replace('oidc_', '');

  let authRequest;
  try {
    authRequest = await provider.getAuthRequest('oidc', rawId);
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : undefined;
    // Log the resolution failure audit event before redirecting.
    logAuthEvent('authrequest_resolve', 'failure', { requestId: rawId, code });
    return { kind: 'error-redirect', code: providerErrorCode(code) };
  }

  const list = await readSessions(request);
  const sessionId = url.searchParams.get('sessionId') ?? undefined;

  // explicit sessionId hand-back from /login/password → finish the callback
  if (sessionId) {
    const entry = byId(list, sessionId);
    if (entry) {
      // Validate liveness BEFORE reuse: a stale post-logout cookie self-heals to /login here
      // instead of reaching createCallback on a terminated session (→ ALREADY_DONE → /error).
      const gate = await healIfSessionDead(provider, list, entry, requestId, rawId, nowMs);
      if ('kind' in gate) return gate; // dead/transient → outcome already decided

      // ANTI-FORGERY FRESHNESS GATE (prompt=login only). The sessionId is query-supplied, so a
      // caller can forge `&sessionId=<their_own_STALE_live_session>` onto a prompt=login request
      // to skip the forced re-authentication the AS explicitly demanded. A handed-back session may
      // satisfy prompt=login ONLY if it was genuinely freshly authenticated THIS ceremony (a
      // primary factor verified within FRESH_LOGIN_WINDOW_MS). If it is stale, fall through to
      // decideAuthorize, which routes prompt=login → /login (forced re-auth). select_account is
      // harmless (picking your own live session), so the gate is scoped to prompt=login.
      const mustReauth =
        authRequest.prompt.includes('login') &&
        !primaryFresh(gate.session.factors, nowMs, await freshLoginWindowMs(provider, entry));
      if (!mustReauth) return runCallback(provider, rawId, entry, list, requestId);
      // else: stale prompt=login → do NOT finalize; fall through to decideAuthorize below.
    }
  }

  const recent = mostRecent(list);
  // Explicit-only org threading: pass the org derived from the OIDC scope verbatim. The
  // default-org fallback (env pin → provider default) is a /login display concern; threading
  // it here caused users outside the default org to be hidden by the scoped findUser call.
  const organization = deriveOrganizationFromScopes(authRequest.scopes);
  const decision = decideAuthorize({
    authRequest,
    hasSessions: list.length > 0,
    validSessionId: recent?.id,
    organization,
  });

  if (decision.target === 'callback') {
    if (!decision.params?.sessionId) return { kind: 'error-redirect', code: 'no_session' };
    const entry = byId(list, decision.params.sessionId);
    if (!entry) return { kind: 'error-redirect', code: 'no_session' };
    // Validate liveness BEFORE reuse (same self-heal as the explicit-sessionId path above). No
    // freshness gate here: for prompt=login decideAuthorize returns target '/login', never
    // 'callback', so this branch is unreachable under prompt=login (only none/default reuse).
    const healed = await healIfSessionDead(provider, list, entry, requestId, rawId, nowMs);
    if ('kind' in healed) return healed;
    return runCallback(provider, rawId, entry, list, requestId);
  }
  if (decision.target === 'error') {
    if (decision.error === 'NO_ACTIVE_SESSION') {
      return { kind: 'json', status: 400, body: { error: 'No active session found' } };
    }
    return { kind: 'error-redirect', code: 'signin_failed' };
  }

  // bootstrap into a screen, threading requestId
  const params = new URLSearchParams({ requestId });
  Object.entries(decision.params ?? {}).forEach(([k, v]) => params.set(k, v));
  return { kind: 'redirect', location: `${decision.target}?${params}` };
}

// ── entrypoint ──────────────────────────────────────────────────────────────────

/**
 * Resolve a GET /authorize request to a typed outcome. Owns the entire loader business
 * logic: normalize the request id, apply the open-redirect guard, then dispatch to the
 * SAML / device / OIDC branch. The route turns the outcome into a Response via
 * `outcomeToResponse`.
 */
export async function resolveAuthorize(
  provider: AuthProvider,
  request: Request,
  nowMs: number = Date.now()
): Promise<AuthorizeOutcome> {
  const url = new URL(request.url);
  const requestId = normalizeRequestId(url);

  // Anything not oidc_/saml_/device_ is rejected before use (open-redirect guard).
  if (!isAllowedRequestId(requestId)) {
    return { kind: 'error-redirect', code: 'no_request' };
  }

  if (requestId.startsWith('saml_')) return resolveSaml(provider, request, requestId);
  if (requestId.startsWith('device_')) return resolveDevice(requestId);
  return resolveOidc(provider, request, url, requestId, nowMs);
}
