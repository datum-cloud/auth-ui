// app/resources/session/session.service.ts
//
// Pass 2 extraction: the BUSINESS logic of the three session-surface routes —
// /signed-in (post-login destination resolution), /accounts (multi-session listing,
// account switch, account removal) and /logout (single-session logout orchestration +
// residual-session guard). React rendering, the CSRF assertion, and the final
// redirect()/data() construction stay thin in the routes.
//
// This is the SESSION-DOMAIN service: it orchestrates the user-facing session lifecycle
// (which account am I, switch to another, sign one out). It is deliberately distinct from
// `@/modules/auth/session/cookie` — the low-level cookie mechanics (serialize/read/cap) —
// which this service composes on top of.
//
// As with the device/authorize domains, each entrypoint resolves to a typed `Outcome` and a
// pure `*ToResponse` translator turns it into the redirect/data() Response the route returns
// verbatim — so every status/redirect/payload/audit assertion is testable at the service
// boundary without a CSRF round-trip (CSRF is asserted in the thin route).
import type { AuthProvider } from '@/modules/auth/auth-provider';
import {
  readSessions,
  mostRecent,
  removeSession,
  addSession,
  serializeSessions,
  listSessions,
  byId,
  type SessionEntry,
} from '@/modules/auth/session/cookie';
import type { Session, AuthMethod, LoginSettings } from '@/modules/auth/types';
import { ProviderError } from '@/modules/auth/types';
import { isAllowedRequestId } from '@/resources/authorize';
import { deviceDecision } from '@/resources/device';
import { postLoginDestinationWithSource } from '@/resources/login/post-login-destination';
import { nextStepWithParams } from '@/resources/shared/next-step-params';
import { paths } from '@/routes/paths';
import { env } from '@/server/infra/env.server';
import { logAuthEvent, hashActor } from '@/server/observability';
import { data, redirect } from 'react-router';
import { z } from 'zod';

// ─── /signed-in — post-login destination ─────────────────────────────────────

/**
 * Typed outcome of the /signed-in loader. The route turns it into a Response via
 * `signedInOutcomeToResponse`: a redirect (protocol forward, no-session bounce, or a
 * configured post-login destination) or the terminal "You are signed in" data() payload.
 */
export type SignedInOutcome =
  | { kind: 'redirect'; location: string }
  // `deviceComplete` marks the post-login device-grant auto-authorization terminal page:
  // the consent was completed automatically (no second manual Authorize click — restores the
  // OLD `completeDeviceAuthorization` behavior), so the route renders the "you can close this
  // window and return to your device" message instead of the standard sign-out form.
  | { kind: 'page'; loginName: string | null; deviceComplete?: boolean }
  // The device grant failed to auto-authorize after login (provider rejected the
  // authorizeDevice call). Inline-only error surface — the route renders a tailored card.
  | { kind: 'device-error' };

/**
 * Config the /signed-in loader needs from the route (env values are owned by the route's
 * `env` import so the service stays free of env-loading side effects and is easy to test).
 */
export interface SignedInConfig {
  /** `${ZITADEL_API_URL}/ui/console` — where instance admins land. */
  consoleUrl: string;
  /** DEFAULT_APP_URL env — fallback when Zitadel has no default configured. */
  defaultAppUrl?: string;
}

/**
 * Resolve the /signed-in loader business logic to a typed outcome.
 *
 * A ceremony that still carries a protocol request must hand back to the orchestrator:
 * oidc_/saml_ to finish the callback (createCallback → client redirect with ?code=),
 * device_ to return to the /device/authorize consent screen (the MFA-setup-skip path lands
 * here with the requestId still threaded). /signed-in is only the terminal page for
 * standalone (requestId-less) logins.
 *
 * Otherwise: require an active cookie session (else /login), resolve the post-login
 * destination (admin console → Zitadel default → env default → none), emit the audit
 * events, and either redirect to the destination or hand back the terminal-page payload.
 */
export async function resolveSignedIn(
  provider: AuthProvider,
  request: Request,
  config: SignedInConfig
): Promise<SignedInOutcome> {
  const requestId = new URL(request.url).searchParams.get('requestId');
  const list = await readSessions(request);
  const recent = mostRecent(list);

  // OIDC/SAML ceremonies hand back to /authorize to finish the protocol callback
  // (createCallback → client ?code=). Hand back the active sessionId too so /authorize completes
  // via the session path (runCallback) instead of re-running decideAuthorize — without it a
  // prompt=select_account request loops straight back to /accounts. The device grant is DIFFERENT:
  // it auto-completes here (resolveDeviceCompletion), not via a second consent screen.
  if (requestId && (requestId.startsWith('oidc_') || requestId.startsWith('saml_'))) {
    const params = new URLSearchParams({ requestId });
    if (recent) params.set('sessionId', recent.id);
    return { kind: 'redirect', location: `/authorize?${params.toString()}` };
  }

  if (!recent) return { kind: 'redirect', location: '/login' };

  // Post-login device-grant AUTO-COMPLETE. The OLD signedin page completed the grant
  // automatically (completeDeviceAuthorization) — no second manual Authorize click. The rebuild
  // regressed to bouncing device_ back to /authorize → /device/authorize (a redundant consent
  // screen). Restore the auto-complete: with an active session present, authorize the grant
  // directly and land on the terminal "return to your device" page.
  if (requestId && requestId.startsWith('device_')) {
    return resolveDeviceCompletion(provider, requestId, recent);
  }

  type Settings = Awaited<ReturnType<typeof provider.getLoginSettings>>;
  const [settings, isAdmin] = await Promise.all([
    provider.getLoginSettings(recent.organization).catch((err) => {
      // Surface transient backend failure in the audit trail; behavior
      // (graceful degradation to env/none) is unchanged.
      logAuthEvent('post_login_settings', 'failure', {
        reason: err instanceof Error ? err.message : String(err),
      });
      return {} as Partial<Settings>;
    }),
    provider.isInstanceAdmin({ id: recent.id, token: recent.token }).catch((err) => {
      logAuthEvent('post_login_admin_check', 'failure', {
        reason: err instanceof Error ? err.message : String(err),
      });
      return false;
    }),
  ]);

  const { dest, source } = postLoginDestinationWithSource({
    isAdmin,
    consoleUrl: config.consoleUrl,
    defaultRedirectUri: settings.defaultRedirectUri,
    defaultAppUrl: config.defaultAppUrl,
  });

  logAuthEvent('post_login_redirect', dest ? 'success' : 'failure', { isAdmin, source });

  if (dest) return { kind: 'redirect', location: dest };

  // Nothing configured → terminal "You are signed in" page.
  return { kind: 'page', loginName: recent.loginName ?? null };
}

/**
 * Complete a device authorization grant automatically after login.
 *
 * Mirrors the OLD `completeDeviceAuthorization` flow: the user code is the stable handle threaded
 * through the login ceremony as `device_<userCode>` (the adapter returns a fresh opaque
 * deviceAuth.id per getDeviceAuth call). Re-resolve the device auth by user code, authorize it
 * against the just-established session, and land on the terminal "return to your device" page —
 * so the user never sees a second manual Authorize click.
 *
 * Failures (NOT_FOUND/expired code, provider outage) resolve to a typed `device-error` outcome
 * the route renders as an inline recovery card. Best-effort throughout: an unexpected non-provider
 * error is also caught and surfaced inline rather than bubbling to the root ErrorBoundary.
 */
async function resolveDeviceCompletion(
  provider: AuthProvider,
  requestId: string,
  recent: SessionEntry
): Promise<SignedInOutcome> {
  const userCode = requestId.slice('device_'.length);

  try {
    const deviceAuth = await provider.getDeviceAuth(userCode);
    await provider.authorizeDevice(
      deviceAuth.id,
      deviceDecision({ decision: 'authorize', session: { id: recent.id, token: recent.token } })
    );
  } catch (err) {
    // Idempotent: the grant may already be finalized — the explicit consent-page POST
    // (resolveDeviceDecision) won the race, or this is a re-entry. ALREADY_DONE means the
    // device IS authorized, so fall through to the success/completion path, not an error.
    if (!(err instanceof ProviderError && err.code === 'ALREADY_DONE')) {
      logAuthEvent('device_authorize', 'failure', {
        requestId,
        actor: hashActor(recent.loginName),
        reason: err instanceof ProviderError ? err.code : 'UNKNOWN',
      });
      return { kind: 'device-error' };
    }
  }

  logAuthEvent('device_authorize', 'success', {
    requestId,
    actor: hashActor(recent.loginName),
  });

  return { kind: 'page', loginName: recent.loginName ?? null, deviceComplete: true };
}

// ─── /accounts — session listing + enrichment ────────────────────────────────

export interface EnrichedAccount {
  sessionId: string;
  loginName: string;
  organization?: string;
  displayName?: string;
  /** path === '/signed-in' means the session is fully active */
  nextPath: string;
  isActive: boolean;
  // Optional IdP indicator for the row badge. Populated by the SSO link↔provider
  // join; until that lands these stay undefined and the row simply renders no badge.
  idpName?: string;
  idpType?: string;
}

/** Shared fallback when a getLoginSettings call fails */
export const DEFAULT_LOGIN_SETTINGS = {
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: false,
  passkeysType: 'not_allowed' as const,
  forceMfa: false,
};

/**
 * Resolves the next navigation path for a session entry.
 *
 * Fetches enrolledMethods and loginSettings in parallel (both tolerate failures), derives
 * userVerified from passkey factors, then delegates to nextStepWithParams for the canonical
 * step-routing logic.
 */
async function resolveNextPath(
  provider: AuthProvider,
  session: Session,
  entry: { loginName: string; organization?: string; requestId?: string },
  // Account-SWITCH passes this so the resolved destination is the continuation
  // (/signed-in) and the step-6 skippable MFA-setup nudge is suppressed. Real forced MFA
  // (settings.forceMfa) and real challenges still route normally.
  //
  // `requestId` is the CURRENT, live ceremony id threaded through the /accounts picker URL
  // (a mid-OIDC/SAML/device account switch) → /signed-in?requestId=<current> → /authorize →
  // client callback. A STANDALONE switch (no live ceremony in the URL) resolves to the normal
  // post-login destination; it deliberately does NOT resume the session's original requestId.
  opts: { suppressMfaSetupNudge?: boolean; requestId?: string } = {}
): Promise<string> {
  const userId = session.user?.id ?? '';

  const [enrolledMethods, loginSettings] = await Promise.all([
    userId
      ? provider.listAuthMethods(userId).catch(() => [] as AuthMethod[])
      : Promise.resolve([] as AuthMethod[]),
    provider.getLoginSettings(entry.organization).catch(() => DEFAULT_LOGIN_SETTINGS),
  ]);

  const userVerified = session.factors.passkey?.userVerified ?? false;

  // Only resume a LIVE ceremony — the current allowlisted requestId threaded through the
  // /accounts URL (a mid-OIDC/SAML/device switch). Do NOT fall back to entry.requestId: a
  // STANDALONE switch must not resume the session's ORIGINAL OIDC/SAML request (baked into the
  // cookie at creation, now long expired), which would hand back to /authorize and fail with
  // request_expired. With no live ceremony the switch resolves to the normal post-login path.
  const requestId = isAllowedRequestId(opts.requestId) ? opts.requestId : undefined;

  return nextStepWithParams({
    factors: session.factors,
    settings: loginSettings,
    enrolledMethods,
    loginName: entry.loginName,
    userVerified,
    mfaInitSkippedAt: session.user?.mfaInitSkippedAt ?? null,
    requestId,
    organization: entry.organization,
    suppressMfaSetupNudge: opts.suppressMfaSetupNudge,
  });
}

/**
 * Resolve the /accounts loader business logic: read the cookie, filter to live (non-expired)
 * sessions, enrich each entry via the provider (best-effort, per-session failures degrade to a
 * needs-re-auth card), and return the EnrichedAccount list. Empty cookie / empty live set both
 * resolve to an empty list (no redirect loop) — the route renders the empty state.
 */
export async function listAccounts(
  provider: AuthProvider,
  request: Request
): Promise<EnrichedAccount[]> {
  const cookieSessions = await readSessions(request);

  // Filter to non-expired entries using current time (shared helper handles both
  // epoch-string and ISO expirationTs formats).
  const liveSessions = listSessions(cookieSessions, Date.now());

  if (liveSessions.length === 0) return [];

  // Enrich via provider.listSessions (read-only; returned sessions have token: '')
  const sessionIds = liveSessions.map((s) => s.id);
  let providerSessions: Session[];
  try {
    providerSessions = await provider.listSessions(sessionIds);
  } catch {
    // If the bulk lookup fails entirely, fall through with an empty enrichment list
    providerSessions = [];
  }

  const providerMap = new Map<string, Session>(providerSessions.map((s) => [s.id, s]));

  // Pre-fetch loginSettings once per distinct organization to avoid redundant round-trips
  // when multiple sessions share the same org (or are all orgless).
  const distinctOrgs = new Set(liveSessions.map((s) => s.organization));
  const settingsMap = new Map<string | undefined, LoginSettings>();
  await Promise.all(
    [...distinctOrgs].map(async (org) => {
      const settings = await provider.getLoginSettings(org).catch(() => DEFAULT_LOGIN_SETTINGS);
      settingsMap.set(org, settings);
    })
  );

  // Dedupe the enrolled-methods N+1. The per-session enrichment below needs the
  // user's enrolled auth methods, but multiple live cookie entries can resolve to the SAME
  // userId (an org session + a default-org session for one account, or duplicate entries).
  // Issuing one `listAuthMethods` PER SESSION was a redundant N+1; instead build a per-request
  // Map<userId, methods> keyed by the DISTINCT userIds present across the resolved provider
  // sessions and issue exactly one `listAuthMethods` per userId. Failures degrade per-user to
  // an empty method list (unchanged from the prior per-session catch). Behavior-identical —
  // the only change is fewer RPCs for the same enrichment output.
  const distinctUserIds = new Set<string>();
  for (const entry of liveSessions) {
    const userId = providerMap.get(entry.id)?.user?.id;
    if (userId) distinctUserIds.add(userId);
  }
  const authMethodsMap = new Map<string, AuthMethod[]>();
  await Promise.all(
    [...distinctUserIds].map(async (userId) => {
      const methods = await provider.listAuthMethods(userId).catch(() => [] as AuthMethod[]);
      authMethodsMap.set(userId, methods);
    })
  );

  // For each live cookie entry, build an EnrichedAccount. Per-session failures are tolerated
  // gracefully (renders needs-re-auth card).
  return Promise.all(
    liveSessions.map(async (entry): Promise<EnrichedAccount> => {
      const pSession = providerMap.get(entry.id);

      // Default (degraded) card if provider has no data for this session
      if (!pSession) {
        return {
          sessionId: entry.id,
          loginName: entry.loginName,
          organization: entry.organization,
          displayName: undefined,
          nextPath: '/login',
          isActive: false,
        };
      }

      const userId = pSession.user?.id ?? '';
      const loginSettings = settingsMap.get(entry.organization) ?? DEFAULT_LOGIN_SETTINGS;

      // Read enrolled methods from the per-request map (one RPC per distinct userId
      // above) instead of re-issuing a call here. A userId absent from the map (e.g. no
      // resolved user) yields the same empty-list default as before.
      const enrolledMethods = userId
        ? (authMethodsMap.get(userId) ?? ([] as AuthMethod[]))
        : ([] as AuthMethod[]);

      const userVerified = pSession.factors.passkey?.userVerified ?? false;

      const nextPath = nextStepWithParams({
        factors: pSession.factors,
        settings: loginSettings,
        enrolledMethods,
        loginName: entry.loginName,
        userVerified,
        mfaInitSkippedAt: pSession.user?.mfaInitSkippedAt ?? null,
        requestId: entry.requestId,
        organization: entry.organization,
      });

      return {
        sessionId: entry.id,
        loginName: entry.loginName,
        organization: entry.organization,
        displayName: pSession.user?.displayName,
        nextPath,
        isActive: entry.loginName === pSession.user?.loginName,
      };
    })
  );
}

// ─── /accounts — switch / remove actions ─────────────────────────────────────

export const switchSchema = z.object({
  intent: z.literal('switch'),
  sessionId: z.string().min(1),
  // The CURRENT ceremony requestId threaded through the /accounts picker (empty/absent for a
  // standalone switch). switchAccount forwards it to resolveNextPath, which only honors an
  // allowlisted (oidc_/saml_/device_) value; a standalone switch resolves to the normal
  // post-login destination (it does NOT resume the session's original, possibly-expired id).
  requestId: z.string().optional(),
  // Device-grant "change account" sub-flow: when present, the switch returns to the device
  // consent screen (/device/authorize?user_code=...) with the newly-active account, so the
  // user reviews and authorizes — instead of the normal post-login destination.
  userCode: z.string().optional(),
});

export const removeSchema = z.object({
  intent: z.literal('remove'),
  sessionId: z.string().min(1),
  // Preserve the CURRENT ceremony requestId on the redirect back to /accounts so removing an
  // account mid-ceremony doesn't drop it (only an allowlisted value is reflected onto the URL).
  requestId: z.string().optional(),
});

export type AccountActionError =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'PROVIDER_ERROR';

/**
 * Typed outcome of the /accounts action. The route turns it into a Response via
 * `accountActionOutcomeToResponse`: a redirect carrying the updated sessions cookie, or a
 * `data()` error with the appropriate status.
 */
export type AccountActionOutcome =
  | { kind: 'redirect'; location: string; setCookie: string }
  | { kind: 'error'; error: AccountActionError; status: 400 | 404 | 500 };

/**
 * Switch the active account: validate input, look up the cookie entry, re-fetch fresh session
 * state for an accurate nextStep determination, touch the entry to most-recent, and redirect to
 * the resolved next path with the updated cookie. Provider failures map to typed errors exactly
 * as the route did (missing session → SESSION_EXPIRED 400; provider throw → PROVIDER_ERROR 500).
 */
export async function switchAccount(
  provider: AuthProvider,
  request: Request,
  form: FormData
): Promise<AccountActionOutcome> {
  const parsed = switchSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { kind: 'error', error: 'INVALID_INPUT', status: 400 };

  const { sessionId, requestId, userCode } = parsed.data;
  const cookieSessions = await readSessions(request);
  const entry = byId(cookieSessions, sessionId);
  if (!entry) return { kind: 'error', error: 'NOT_FOUND', status: 404 };

  // Re-fetch fresh session state for an accurate nextStep determination
  let nextPath: string;
  let userId: string;
  try {
    const freshSession = await provider.getSession(entry.id, entry.token);
    if (!freshSession) {
      logAuthEvent('account_switch', 'failure', { sessionId });
      return { kind: 'error', error: 'SESSION_EXPIRED', status: 400 };
    }

    userId = freshSession.user?.id ?? entry.loginName;
    // On switch, resolve to the continuation/signed-in destination and suppress
    // ONLY the step-6 skippable MFA-setup nudge. Forced MFA + real challenges still route.
    // `requestId` carries the CURRENT ceremony (a mid-OIDC/SAML/device switch) so the resolved
    // path threads the live id back into the protocol callback instead of the stale cookie one.
    nextPath = await resolveNextPath(provider, freshSession, entry, {
      suppressMfaSetupNudge: true,
      requestId,
    });
  } catch {
    logAuthEvent('account_switch', 'failure', { sessionId });
    return { kind: 'error', error: 'PROVIDER_ERROR', status: 500 };
  }

  // Touch the session in the cookie (re-order to most-recent via addSession)
  const updated = addSession(cookieSessions, { ...entry, changeTs: String(Date.now()) });

  logAuthEvent('account_switch', 'success', { sessionId, userId });

  // Device-grant "change account": the switched-to account is now mostRecent, so return to the
  // /device/authorize consent screen for review + Authorize. Standalone/OIDC switches keep the
  // normal resolved destination.
  const location = userCode ? paths.device.authorize({ user_code: userCode }) : nextPath;
  return { kind: 'redirect', location, setCookie: await serializeSessions(updated) };
}

/**
 * Remove an account: validate input, look up the cookie entry, delete provider-side
 * (best-effort — cookie removal proceeds even if the provider call fails), remove from the
 * cookie, and redirect back to /accounts with the updated cookie. Missing entry → NOT_FOUND 404.
 */
export async function removeAccount(
  provider: AuthProvider,
  request: Request,
  form: FormData
): Promise<AccountActionOutcome> {
  const parsed = removeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { kind: 'error', error: 'INVALID_INPUT', status: 400 };

  const { sessionId, requestId } = parsed.data;
  const cookieSessions = await readSessions(request);
  const entry = byId(cookieSessions, sessionId);
  if (!entry) {
    logAuthEvent('account_remove', 'failure', { sessionId, reason: 'not_found' });
    return { kind: 'error', error: 'NOT_FOUND', status: 404 };
  }

  // Delete provider-side (best-effort — cookie removal proceeds even if provider call fails)
  try {
    await provider.deleteSession(entry.id, entry.token);
  } catch {
    logAuthEvent('account_remove', 'failure', {
      sessionId,
      actor: hashActor(entry.loginName),
      reason: 'provider_error',
    });
    // Tolerate provider errors; the session will still be removed from the cookie
  }

  const updated = removeSession(cookieSessions, sessionId);
  logAuthEvent('account_remove', 'success', { sessionId, actor: hashActor(entry.loginName) });

  // Carry the live ceremony id back onto /accounts so a mid-ceremony remove keeps the flow.
  const location = isAllowedRequestId(requestId)
    ? `/accounts?requestId=${encodeURIComponent(requestId)}`
    : '/accounts';

  return { kind: 'redirect', location, setCookie: await serializeSessions(updated) };
}

/**
 * Resolve an /accounts action submission to a typed outcome by dispatching on `intent`.
 * Unknown / missing intent → INVALID_INPUT 400 (same as the route's terminal fall-through).
 */
export async function resolveAccountAction(
  provider: AuthProvider,
  request: Request,
  form: FormData
): Promise<AccountActionOutcome> {
  const intent = form.get('intent') as string | null;
  if (intent === 'switch') return switchAccount(provider, request, form);
  if (intent === 'remove') return removeAccount(provider, request, form);
  return { kind: 'error', error: 'INVALID_INPUT', status: 400 };
}

/** Turn an AccountActionOutcome into the Response the /accounts route returns. */
export function accountActionOutcomeToResponse(outcome: AccountActionOutcome) {
  if (outcome.kind === 'redirect') {
    return redirect(outcome.location, { headers: { 'set-cookie': outcome.setCookie } });
  }
  return data({ error: outcome.error }, { status: outcome.status });
}

// ─── /logout — single-session logout orchestration ───────────────────────────

/**
 * Typed outcome of the /logout action. The route turns it into a Response via
 * `logoutOutcomeToResponse`: a redirect carrying the updated (post-removal) sessions cookie.
 */
export interface LogoutOutcome {
  location: string;
  setCookie: string;
}

/** Parse the comma-separated POST_LOGOUT_ALLOWLIST env into a list of origins. */
function parsePostLogoutAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Validate the post-logout destination for the OIDC logout handshake (hop 3→4).
 *
 * Accepts either query param Zitadel may use: `post_logout_redirect` (the value it
 * appends when bouncing end_session → /id/logout) or `post_logout_redirect_uri`.
 *
 * Fail-closed open-redirect guard:
 *   • absolute URL → allowed ONLY if its origin is in POST_LOGOUT_ALLOWLIST
 *   • relative paths (e.g. Zitadel's default "/logout/done") → rejected; caller falls
 *     back to /logout/success (the actual signed-out page in this login UI)
 *   • anything else / missing → null (caller falls back to /logout/success)
 *
 * `allowlist` is injectable so unit tests exercise both branches without mutating env.
 */
export function validatePostLogoutRedirect(
  request: Request,
  allowlist: string[] = parsePostLogoutAllowlist(env.POST_LOGOUT_ALLOWLIST)
): string | null {
  const params = new URL(request.url).searchParams;
  const target = params.get('post_logout_redirect') ?? params.get('post_logout_redirect_uri');
  if (!target) return null;

  // Only honor an allowlisted ABSOLUTE RP URL. Relative paths — notably Zitadel's default
  // `/logout/done`, which is NOT a route in this login UI (its signed-out page is
  // /logout/success) — are rejected so the caller falls back to /logout/success.
  try {
    const origin = new URL(target).origin; // throws for relative paths → rejected
    return allowlist.includes(origin) ? target : null;
  } catch {
    return null;
  }
}

/**
 * Orchestrate a single-session logout. Reads the cookie, signs the most-recent (active) session
 * out provider-side (best-effort: an unreachable provider must not strand the user — local
 * sign-out MUST always succeed because the cookie is the UI's source of truth), removes only that
 * entry from the cookie, then resolves the post-logout destination.
 *
 * Residual-session guard: when residual sessions remain after the single-session removal, redirect to
 * /accounts (forces explicit account selection) instead of /logout/success — otherwise
 * authorize.tsx could silently reuse mostRecent() of the residuals and re-sign-in the user with
 * no interaction. When no residual sessions remain, /logout/success is correct.
 */
export async function performLogout(
  provider: AuthProvider,
  request: Request
): Promise<LogoutOutcome> {
  const sessions = await readSessions(request);
  const active = mostRecent(sessions); // the cookie's active entry (if any)

  if (active) {
    // deleteSession may throw if the session is already gone on the provider side (e.g.
    // expired, or a transport error). Wrap in try/catch — on failure emit an audit event
    // but CONTINUE clearing the local cookie and redirecting. Local sign-out MUST always
    // succeed: the cookie is the source of truth for the UI and an unreachable provider must
    // not leave the user stuck on /signed-in.
    try {
      await provider.deleteSession(active.id, active.token);
      logAuthEvent('logout', 'success', {
        actor: hashActor(active.loginName),
        sessionId: active.id,
      });
    } catch (err) {
      // reason distinguishes transport outages from stale sessions in ops triage (no tokens logged)
      logAuthEvent('logout', 'failure', {
        sessionId: active.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      // fall through — clear cookie + redirect regardless
    }
  }

  // removeSession takes a string ID; only call it when active exists.
  const next = active ? removeSession(sessions, active.id) : sessions;

  const explicitTarget = validatePostLogoutRedirect(request);
  const hasResidualSessions = next.length > 0;
  const target = explicitTarget ?? (hasResidualSessions ? '/accounts' : '/logout/success');

  return { location: target, setCookie: await serializeSessions(next) };
}

/** Turn a LogoutOutcome into the Response the /logout route returns. */
export function logoutOutcomeToResponse(outcome: LogoutOutcome) {
  return redirect(outcome.location, { headers: { 'set-cookie': outcome.setCookie } });
}

/**
 * Complete a Zitadel-initiated OIDC logout (the end_session → /id/logout?logout_token handshake).
 *
 * Global SSO logout: deletes EVERY v2 session in the cookie (not just the active one) so no
 * residual session can be silently reused by /authorize, then clears the whole `sessions` cookie.
 * deleteSession is best-effort per entry: an already-terminated (NOT_FOUND) or unreachable session
 * must not strand the user — the cookie is cleared and the redirect issued regardless.
 *
 * Destination: an allowlist-validated `post_logout_redirect` (the value Zitadel forwarded from the
 * RP), else the local /logout/success page. The validation is the open-redirect guard.
 */
export async function completeOidcLogout(
  provider: AuthProvider,
  request: Request
): Promise<LogoutOutcome> {
  const sessions = await readSessions(request);

  await Promise.all(
    sessions.map(async (entry) => {
      try {
        await provider.deleteSession(entry.id, entry.token);
        logAuthEvent('logout', 'success', {
          actor: hashActor(entry.loginName),
          sessionId: entry.id,
        });
      } catch (err) {
        logAuthEvent('logout', 'failure', {
          sessionId: entry.id,
          reason: err instanceof Error ? err.message : String(err),
        });
        // best-effort: continue clearing + redirecting
      }
    })
  );

  const target = validatePostLogoutRedirect(request) ?? '/logout/success';
  return { location: target, setCookie: await serializeSessions([]) };
}

export type { SessionEntry };
