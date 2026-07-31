// app/resources/session/session-logout.service.ts
//
// The /logout slice of the session domain, extracted from session.service.ts to keep that file
// under the size ceiling. Covers single-session logout (performLogout), the OIDC end_session
// handshake completion (completeOidcLogout), and the post-logout open-redirect guard
// (validatePostLogoutRedirect). session.service.ts re-exports these so the barrel and existing
// direct importers (tests) are unchanged.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import {
  readSessions,
  mostRecent,
  removeSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { readPasskeyHint, clearPasskeyHint } from '@/modules/auth/session/passkey-hint';
import { env } from '@/server/infra/env.server';
import { logAuthEvent, hashActor } from '@/server/observability';
import { redirect } from 'react-router';

/**
 * Typed outcome of the /logout action. The route turns it into a Response via
 * `logoutOutcomeToResponse`: a redirect carrying the updated (post-removal) sessions cookie.
 */
export interface LogoutOutcome {
  location: string;
  setCookie: string;
  /** Clears the passkey-hint — set only when the signing-out identity owns it (or on sign-out-of-all). */
  clearHintCookie?: string;
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

  // Owner-scoped hint clearing: "logout clears everything" from the perspective of WHOEVER
  // signed out. Alice signing out must not erase Bob's fast path.
  const hint = await readPasskeyHint(request);
  const clearHintCookie =
    active && hint && hint.toLowerCase() === active.loginName.toLowerCase()
      ? await clearPasskeyHint()
      : undefined;

  return { location: target, setCookie: await serializeSessions(next), clearHintCookie };
}

/** Turn a LogoutOutcome into the Response the /logout route returns. */
export function logoutOutcomeToResponse(outcome: LogoutOutcome) {
  const headers = new Headers();
  headers.append('set-cookie', outcome.setCookie);
  if (outcome.clearHintCookie) headers.append('set-cookie', outcome.clearHintCookie);
  return redirect(outcome.location, { headers });
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
  return {
    location: target,
    setCookie: await serializeSessions([]),
    // Sign-out-of-all: no session survives, so no identity keeps a claim on the hint.
    clearHintCookie: await clearPasskeyHint(),
  };
}
