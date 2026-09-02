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
import { serializePasskeyHint } from '@/modules/auth/session/passkey-hint';
import { serializeReauthIntent } from '@/modules/auth/session/reauth-intent';
import type { Session, AuthMethod, LoginSettings, ProviderErrorCode } from '@/modules/auth/types';
import { ProviderError } from '@/modules/auth/types';
import { isAllowedRequestId } from '@/resources/authorize';
import { postLoginDestinationWithSource } from '@/resources/login/post-login-destination';
import { userCodeSchema } from '@/resources/schemas/user-code';
import { nextStepWithParams } from '@/resources/shared/next-step-params';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { paths } from '@/routes/paths';
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
  | { kind: 'page'; loginName: string | null; userId: string | null };

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
  // prompt=select_account request loops straight back to /accounts. A device grant is DIFFERENT:
  // it hands back to the /device/authorize consent screen (see the device_ branch below).
  if (requestId && (requestId.startsWith('oidc_') || requestId.startsWith('saml_'))) {
    const params = new URLSearchParams({ requestId });
    if (recent) params.set('sessionId', recent.id);
    return { kind: 'redirect', location: `/authorize?${params.toString()}` };
  }

  // Post-login device-grant: a state-changing RFC 8628 consent grant must NOT be
  // auto-completed from this GET loader — the ?requestId= is forgeable and carries no consent
  // proof, so auto-completing here let an emailed /signed-in?requestId=device_<code> link
  // silently authorize an attacker's device against the victim's session. Hand back to the real
  // /device/authorize consent screen (mirrors authorize.service.ts' device_ branch), which
  // requires an explicit CSRF-protected Approve click showing the requesting app + scope.
  if (requestId && requestId.startsWith('device_')) {
    const params = new URLSearchParams({ user_code: requestId.slice('device_'.length) });
    return { kind: 'redirect', location: `/device/authorize?${params}` };
  }

  if (!recent) return { kind: 'redirect', location: '/login' };

  type Settings = Awaited<ReturnType<typeof provider.getLoginSettings>>;
  const [settings, isAdmin, session] = await Promise.all([
    // Org-first: the session's org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
    provider.getLoginSettings(recent.organization ?? (await resolveOrg(provider))).catch((err) => {
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
    // Best-effort: resolves the Zitadel user id for client-side analytics identify() on the
    // terminal page. A failure here never blocks the redirect/page resolution below.
    provider.getSession(recent.id, recent.token).catch((err) => {
      logAuthEvent('post_login_identity_fetch', 'failure', {
        reason: err instanceof Error ? err.message : String(err),
      });
      return null;
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
  return { kind: 'page', loginName: recent.loginName ?? null, userId: session?.user?.id ?? null };
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
    // Org-first: the session's org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
    provider
      .getLoginSettings(entry.organization ?? (await resolveOrg(provider)))
      .catch(() => DEFAULT_LOGIN_SETTINGS),
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
    // The session's own name, not the cookie label: the next step's URL carries this loginName
    // into flows that resolve a user from it, and a cookie minted before the issue #1485 fix (or
    // before a rename) holds a stale one. Matches the `session.user?.loginName ?? loginName`
    // idiom already used by otp.service / mfa.service / webauthn.service.
    loginName: session.user?.loginName ?? entry.loginName,
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
/**
 * Build the EnrichedAccount card for ONE live cookie entry from the pre-fetched per-request maps
 * (provider sessions, login settings per org, auth methods per userId). A session the provider has
 * no data for degrades to a "needs re-authentication" card. Synchronous: every lookup is an
 * in-memory map read (the RPCs were batched by listAccounts into the maps).
 */
function enrichSessionEntry(
  entry: SessionEntry,
  maps: {
    providerMap: Map<string, Session>;
    settingsMap: Map<string | undefined, LoginSettings>;
    authMethodsMap: Map<string, AuthMethod[]>;
  }
): EnrichedAccount {
  const pSession = maps.providerMap.get(entry.id);

  // Default (degraded) card if the provider has no data for this session.
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
  const loginSettings = maps.settingsMap.get(entry.organization) ?? DEFAULT_LOGIN_SETTINGS;
  // Read enrolled methods from the per-request map (one RPC per distinct userId); a userId absent
  // from the map (e.g. no resolved user) yields the same empty-list default as before.
  const enrolledMethods = userId
    ? (maps.authMethodsMap.get(userId) ?? ([] as AuthMethod[]))
    : ([] as AuthMethod[]);
  const userVerified = pSession.factors.passkey?.userVerified ?? false;

  const nextPath = nextStepWithParams({
    factors: pSession.factors,
    settings: loginSettings,
    enrolledMethods,
    loginName: pSession.user?.loginName ?? entry.loginName,
    userVerified,
    mfaInitSkippedAt: pSession.user?.mfaInitSkippedAt ?? null,
    // Display-only enrichment: do NOT thread the cookie-baked requestId (a long-expired OIDC/SAML
    // id) — it would bake a stale, misleading id into nextPath. The LIVE ceremony id is supplied
    // separately to switchAccount → resolveNextPath at switch time.
    requestId: undefined,
    organization: entry.organization,
  });

  return {
    sessionId: entry.id,
    loginName: entry.loginName,
    organization: entry.organization,
    displayName: pSession.user?.displayName,
    nextPath,
    // Liveness, not label equality. This used to compare the cookie's loginName against the
    // session's, so a perfectly live session whose cookie carried a different spelling of the same
    // identity rendered as "Needs re-authentication" — exactly what issue #1485 reported for
    // GitHub accounts. A session the provider resolved to a user IS active; a dead one never gets
    // here (the !pSession branch above already returns the degraded card).
    isActive: pSession.user !== undefined,
  };
}

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
      // Org-first: the session's org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
      // The map stays KEYED by the raw org so the synchronous enrichSessionEntry lookup still matches.
      const settings = await provider
        .getLoginSettings(org ?? (await resolveOrg(provider)))
        .catch(() => DEFAULT_LOGIN_SETTINGS);
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

  // Build each EnrichedAccount from the batched maps. Per-session failures degrade gracefully
  // (enrichSessionEntry renders a needs-re-auth card). Synchronous map — all RPCs were batched above.
  return liveSessions.map((entry) =>
    enrichSessionEntry(entry, { providerMap, settingsMap, authMethodsMap })
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
  // user reviews and authorizes — instead of the normal post-login destination. Bounded to the
  // OAuth device user_code shape (alphanumeric + - / _) so a malformed value can't pollute the
  // device_<code> requestId or the redirect.
  userCode: userCodeSchema,
});

export const removeSchema = z.object({
  intent: z.literal('remove'),
  sessionId: z.string().min(1),
  // Preserve the CURRENT ceremony requestId on the redirect back to /accounts so removing an
  // account mid-ceremony doesn't drop it (only an allowlisted value is reflected onto the URL).
  requestId: z.string().optional(),
  // Preserve the CURRENT ceremony organization on the redirect back to /accounts too — the remove
  // form (accounts.tsx) submits it, and without a schema key Zod would strip it, so a mid-ceremony
  // org scope would silently drop off "Add an account"/signup after a remove (→ wrong default org).
  // Capped as defense-in-depth (Zitadel org ids are short).
  organization: z.string().max(64).optional(),
  // Device-grant "change account" sub-flow: preserve the stable user_code on the redirect back
  // to /accounts (mirrors requestId for OIDC/SAML) so removing an account mid-device-grant keeps
  // the device context — a subsequent switch/add still returns to /device/authorize. Bounded to
  // the OAuth device user_code shape so a malformed value can't be reflected onto the redirect.
  userCode: userCodeSchema,
});

export type AccountActionError =
  'INVALID_INPUT' | 'NOT_FOUND' | 'SESSION_EXPIRED' | 'PROVIDER_ERROR';

/**
 * Typed outcome of the /accounts action. The route turns it into a Response via
 * `accountActionOutcomeToResponse`: a redirect carrying the updated sessions cookie, or a
 * `data()` error with the appropriate status.
 */
export type AccountActionOutcome =
  | { kind: 'redirect'; location: string; setCookie: string; cookies?: string[] }
  | { kind: 'error'; error: AccountActionError; status: 400 | 404 | 500 };

// getSession failures that are genuinely transient backend problems (NOT a dead session): these
// keep surfacing as PROVIDER_ERROR 500 so real outages stay visible/alertable. EVERY other
// provider error (NOT_FOUND / PERMISSION_DENIED / FAILED_PRECONDITION / …) means the stored
// session token is stale or revoked — the "Needs re-authentication" state — and is recovered by
// routing the user to re-login rather than dead-ending on a 500.
const SWITCH_TRANSIENT_CODES = new Set<ProviderErrorCode>([
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'RATE_LIMITED',
]);

/**
 * Recover a switch into a "Needs re-authentication" account: its stored session token is
 * stale/revoked, so the session can't be activated (getSession throws or returns null). Send the
 * user to re-login for THIS identity, resuming any live ceremony — a device user_code takes
 * precedence (device_<code>), else an allowlisted OIDC/SAML requestId — so the original flow still
 * completes after they sign back in. The loginName is pre-filled so the user re-authenticates the
 * exact account they picked.
 *
 * The dead entry is INTENTIONALLY kept (not pruned) until re-auth of this identity actually
 * succeeds: a `reauth-intent` cookie records the identity being re-authenticated, and the login /
 * IdP completion point verifies the result matches it — pruning the stale entry only on a match,
 * and on a MISMATCH keeping both accounts (so a wrong/abandoned re-auth never silently drops the
 * account or completes the ceremony as someone else).
 */
async function reauthRedirect(
  entry: SessionEntry,
  cookieSessions: SessionEntry[],
  requestId: string | undefined,
  userCode: string | undefined
): Promise<AccountActionOutcome> {
  const ceremony: Record<string, string | undefined> = userCode
    ? { requestId: `device_${userCode}` }
    : isAllowedRequestId(requestId)
      ? { requestId }
      : {};
  const location = paths.login.index({ ...ceremony, loginName: entry.loginName });
  return {
    kind: 'redirect',
    location,
    setCookie: await serializeSessions(cookieSessions),
    cookies: [await serializeReauthIntent(entry.loginName)],
  };
}

/**
 * Switch the active account: validate input, look up the cookie entry, re-fetch fresh session
 * state for an accurate nextStep determination, touch the entry to most-recent, and redirect to
 * the resolved next path with the updated cookie. A dead/stale session (getSession throws or
 * returns null) is recovered by routing the user to re-login (see reauthRedirect) instead of a
 * dead-end error; only a transient backend failure during load, or a failure while RESOLVING the
 * next path, maps to PROVIDER_ERROR 500.
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

  // Load the live session FIRST. A "Needs re-authentication" account has a stale/revoked token,
  // so getSession throws (or returns null) — that is NOT a server error. Drop the dead entry and
  // route the user to re-login for this identity (resuming any live ceremony) instead of a
  // dead-end 500. Only genuinely transient backend failures keep surfacing as PROVIDER_ERROR.
  let freshSession: Session | null;
  try {
    freshSession = await provider.getSession(entry.id, entry.token);
  } catch (err) {
    const reason = err instanceof ProviderError ? err.code : 'UNKNOWN';
    if (err instanceof ProviderError && !SWITCH_TRANSIENT_CODES.has(err.code)) {
      logAuthEvent('account_switch', 'failure', { sessionId, reason, recovery: 'reauth' });
      return reauthRedirect(entry, cookieSessions, requestId, userCode);
    }
    logAuthEvent('account_switch', 'failure', { sessionId, reason });
    return { kind: 'error', error: 'PROVIDER_ERROR', status: 500 };
  }

  if (!freshSession) {
    // Session no longer exists provider-side → same re-auth recovery as a stale token.
    logAuthEvent('account_switch', 'failure', {
      sessionId,
      reason: 'SESSION_GONE',
      recovery: 'reauth',
    });
    return reauthRedirect(entry, cookieSessions, requestId, userCode);
  }

  // Resolve the continuation destination. A throw HERE is a genuine backend failure (the session
  // itself loaded fine), so it stays a PROVIDER_ERROR 500.
  let nextPath: string;
  let userId: string;
  try {
    userId = freshSession.user?.id ?? entry.loginName;
    // On switch, resolve to the continuation/signed-in destination and suppress
    // ONLY the step-6 skippable MFA-setup nudge. Forced MFA + real challenges still route.
    // `requestId` carries the CURRENT ceremony (a mid-OIDC/SAML/device switch) so the resolved
    // path threads the live id back into the protocol callback instead of the stale cookie one.
    nextPath = await resolveNextPath(provider, freshSession, entry, {
      suppressMfaSetupNudge: true,
      requestId,
    });
  } catch (err) {
    logAuthEvent('account_switch', 'failure', {
      sessionId,
      reason: err instanceof ProviderError ? err.code : 'UNKNOWN',
    });
    return { kind: 'error', error: 'PROVIDER_ERROR', status: 500 };
  }

  // Touch the session in the cookie (re-order to most-recent via addSession)
  const updated = addSession(cookieSessions, { ...entry, changeTs: String(Date.now()) });

  logAuthEvent('account_switch', 'success', { sessionId, userId });

  // Device-grant "change account": the switched-to account is now mostRecent, so return to the
  // /device/authorize consent screen for review + Authorize. Standalone/OIDC switches keep the
  // normal resolved destination.
  const location = userCode ? paths.device.authorize({ user_code: userCode }) : nextPath;
  return {
    kind: 'redirect',
    location,
    setCookie: await serializeSessions(updated),
    // The switched-to account is now this browser's active identity — refresh the hint
    // reauthRedirect (dead session) intentionally does
    // NOT rewrite it: identity is not re-established until re-auth actually succeeds.
    cookies: [await serializePasskeyHint(entry.loginName)],
  };
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

  const { sessionId, requestId, userCode, organization } = parsed.data;
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

  // Carry the live ceremony context back onto /accounts so a mid-ceremony remove keeps the flow.
  // Device grant (user_code) takes precedence over an OIDC/SAML requestId — the two are mutually
  // exclusive in practice, but the device sub-flow is keyed on user_code. `organization` rides
  // alongside whichever is present (withQuery drops it when undefined) so the org scope survives
  // the round-trip. Build every branch through the typed paths.accounts() registry.
  const location = paths.accounts({
    ...(userCode ? { user_code: userCode } : isAllowedRequestId(requestId) ? { requestId } : {}),
    organization,
  });

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
    const headers = new Headers();
    headers.append('set-cookie', outcome.setCookie);
    for (const cookie of outcome.cookies ?? []) headers.append('set-cookie', cookie);
    return redirect(outcome.location, { headers });
  }
  return data({ error: outcome.error }, { status: outcome.status });
}

// ─── /logout — single-session logout orchestration ───────────────────────────
// Extracted to session-logout.service.ts to keep this file under the size ceiling. Re-exported
// here so the barrel and existing direct importers (logout tests) are unchanged.
export {
  performLogout,
  logoutOutcomeToResponse,
  completeOidcLogout,
  validatePostLogoutRedirect,
} from './session-logout.service';
export type { LogoutOutcome } from './session-logout.service';

export type { SessionEntry };
