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
import { postLoginDestinationWithSource } from '@/resources/login/post-login-destination';
import { nextStepWithParams } from '@/resources/shared/next-step-params';
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
  | { kind: 'page'; loginName: string | null };

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
  if (
    requestId &&
    (requestId.startsWith('oidc_') ||
      requestId.startsWith('saml_') ||
      requestId.startsWith('device_'))
  ) {
    return { kind: 'redirect', location: `/authorize?requestId=${encodeURIComponent(requestId)}` };
  }

  const list = await readSessions(request);
  const recent = mostRecent(list);
  if (!recent) return { kind: 'redirect', location: '/login' };

  type Settings = Awaited<ReturnType<typeof provider.getLoginSettings>>;
  const [settings, isAdmin] = await Promise.all([
    provider.getLoginSettings(recent.organization).catch((err) => {
      // CODE-MAJ-05: surface transient backend failure in the audit trail; behavior
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

// ─── /accounts — session listing + enrichment ────────────────────────────────

export interface EnrichedAccount {
  sessionId: string;
  loginName: string;
  organization?: string;
  displayName?: string;
  /** path === '/signed-in' means the session is fully active */
  nextPath: string;
  isActive: boolean;
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
  entry: { loginName: string; organization?: string; requestId?: string }
): Promise<string> {
  const userId = session.user?.id ?? '';

  const [enrolledMethods, loginSettings] = await Promise.all([
    userId
      ? provider.listAuthMethods(userId).catch(() => [] as AuthMethod[])
      : Promise.resolve([] as AuthMethod[]),
    provider.getLoginSettings(entry.organization).catch(() => DEFAULT_LOGIN_SETTINGS),
  ]);

  const userVerified = session.factors.passkey?.userVerified ?? false;

  return nextStepWithParams({
    factors: session.factors,
    settings: loginSettings,
    enrolledMethods,
    loginName: entry.loginName,
    userVerified,
    mfaInitSkippedAt: session.user?.mfaInitSkippedAt ?? null,
    requestId: entry.requestId,
    organization: entry.organization,
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

      const enrolledMethods = await (userId
        ? provider.listAuthMethods(userId).catch(() => [] as AuthMethod[])
        : Promise.resolve([] as AuthMethod[]));

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
        isActive: nextPath === '/signed-in' || nextPath.startsWith('/signed-in?'),
      };
    })
  );
}

// ─── /accounts — switch / remove actions ─────────────────────────────────────

export const switchSchema = z.object({
  intent: z.literal('switch'),
  sessionId: z.string().min(1),
});

export const removeSchema = z.object({
  intent: z.literal('remove'),
  sessionId: z.string().min(1),
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

  const { sessionId } = parsed.data;
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
    nextPath = await resolveNextPath(provider, freshSession, entry);
  } catch {
    logAuthEvent('account_switch', 'failure', { sessionId });
    return { kind: 'error', error: 'PROVIDER_ERROR', status: 500 };
  }

  // Touch the session in the cookie (re-order to most-recent via addSession)
  const updated = addSession(cookieSessions, { ...entry, changeTs: String(Date.now()) });

  logAuthEvent('account_switch', 'success', { sessionId, userId });

  return { kind: 'redirect', location: nextPath, setCookie: await serializeSessions(updated) };
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

  const { sessionId } = parsed.data;
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

  return { kind: 'redirect', location: '/accounts', setCookie: await serializeSessions(updated) };
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

/**
 * validatePostLogoutRedirect — fail-closed placeholder.
 *
 * post_logout_redirect_uri allowlist lands when OIDC end-session wiring does; fail-closed
 * until then — never echo a caller-supplied URL.
 */
function validatePostLogoutRedirect(_request: Request): string | null {
  return null;
}

/**
 * Orchestrate a single-session logout. Reads the cookie, signs the most-recent (active) session
 * out provider-side (best-effort: an unreachable provider must not strand the user — local
 * sign-out MUST always succeed because the cookie is the UI's source of truth), removes only that
 * entry from the cookie, then resolves the post-logout destination.
 *
 * CODE-MAJ-10 guard: when residual sessions remain after the single-session removal, redirect to
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

export type { SessionEntry };
