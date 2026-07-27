// app/resources/passkeys/passkeys.service.ts
//
// /id/passkeys management: list, sudo-gated remove with the server-side
// last-method guard, and the post-removal "sign out other sessions" offer.
// The sudo check in removeUserPasskey is THE security boundary — the loader check
// is UX only (a stale deep-link is rejected here regardless of entry route).
import type { AuthProvider } from '@/modules/auth/auth-provider';
// Pure helpers from session/session (not cookie.ts) — cookie.ts is stubbed to no-ops
// in the Cypress component bundle; identical at runtime (cookie.ts re-exports it).
import { mostRecent, type SessionEntry } from '@/modules/auth/session/session';
import { ProviderError } from '@/modules/auth/types';
import { validateReturnTo } from '@/resources/shared/return-to';
import { isSudoFresh } from '@/resources/shared/sudo';
import { paths } from '@/routes/paths';
import { logAuthEvent, hashActor } from '@/server/observability';

export interface PasskeyRow {
  id: string;
  state: 'active' | 'inactive';
  name: string;
  /** Enroll time (ISO); absent for enrollments with no created-at metadata or on metadata degrade. */
  createdAt?: string;
}

export type PasskeysViewResult =
  | { kind: 'redirect'; target: string }
  | {
      kind: 'view';
      loginName: string;
      userId: string;
      passkeys: PasskeyRow[];
      methodCount: number;
      returnTo: string | null;
    };

/** The /reauth target carrying the round-trip back to /passkeys. */
function reauthTarget(): string {
  return `${paths.reauth()}?returnTo=${encodeURIComponent(paths.passkeys())}`;
}

/** Resolve the active entry + live session + userId, or null when any link is dead. */
async function resolveActive(
  provider: AuthProvider,
  sessions: SessionEntry[]
): Promise<{
  entry: SessionEntry;
  factors: import('@/modules/auth/types').Factors;
  userId: string;
} | null> {
  const entry = mostRecent(sessions);
  if (!entry) return null;
  const session = await provider.getSession(entry.id, entry.token);
  if (!session) return null;
  const userId = session.user?.id ?? (await provider.findUser(entry.loginName))?.id;
  if (!userId) return null;
  return { entry, factors: session.factors, userId };
}

/**
 * Loader view: requires a live session; stale sudo redirects to /reauth (UX check —
 * the actions re-enforce). Fresh sudo returns rows + methodCount (drives the
 * backup-method banner when == 1) + the validated returnTo.
 */
export async function loadPasskeysView(
  provider: AuthProvider,
  sessions: SessionEntry[],
  input: { returnTo: string | null; nowMs: number }
): Promise<PasskeysViewResult> {
  const active = await resolveActive(provider, sessions);
  if (!active) return { kind: 'redirect', target: paths.login.index() };

  if (!isSudoFresh(active.factors, input.nowMs)) {
    return { kind: 'redirect', target: reauthTarget() };
  }

  const [passkeys, methods] = await Promise.all([
    provider.listPasskeys(active.userId),
    provider.listAuthMethods(active.userId),
  ]);

  return {
    kind: 'view',
    loginName: active.entry.loginName,
    userId: active.userId,
    passkeys,
    methodCount: methods.length,
    returnTo: validateReturnTo(input.returnTo),
  };
}

export type RemovePasskeyResult =
  | { ok: true; removedName: string | null }
  | { ok: false; error: 'SESSION_EXPIRED' | 'SUDO_REQUIRED' | 'LAST_METHOD' };

/**
 * Sudo-gated passkey removal with the server-side last-method guard
 * (listAuthMethods IS Zitadel's listAuthenticationMethodTypes — refuse removing the
 * final sign-in method). NOT_FOUND from the adapter is idempotent success (removal race).
 */
export async function removeUserPasskey(
  provider: AuthProvider,
  sessions: SessionEntry[],
  input: { passkeyId: string; nowMs: number }
): Promise<RemovePasskeyResult> {
  const active = await resolveActive(provider, sessions);
  if (!active) return { ok: false, error: 'SESSION_EXPIRED' };

  if (!isSudoFresh(active.factors, input.nowMs)) {
    logAuthEvent('passkey_remove', 'failure', {
      actor: hashActor(active.entry.loginName),
      reason: 'sudo_required',
    });
    return { ok: false, error: 'SUDO_REQUIRED' };
  }

  const [passkeys, methods] = await Promise.all([
    provider.listPasskeys(active.userId),
    provider.listAuthMethods(active.userId),
  ]);
  // Refuse removing the user's FINAL sign-in method: at most one passkey left AND no
  // other method enrolled.
  if (passkeys.length <= 1 && !methods.some((m) => m !== 'passkey')) {
    logAuthEvent('passkey_remove', 'failure', {
      userId: active.userId,
      reason: 'last_method',
    });
    return { ok: false, error: 'LAST_METHOD' };
  }

  const removedName = passkeys.find((p) => p.id === input.passkeyId)?.name ?? null;
  try {
    await provider.removePasskey(active.userId, input.passkeyId);
  } catch (err) {
    if (!(err instanceof ProviderError && err.code === 'NOT_FOUND')) {
      logAuthEvent('passkey_remove', 'failure', { userId: active.userId });
      throw err;
    }
    // Removal race — the passkey is already gone; treat as success.
  }

  logAuthEvent('passkey_remove', 'success', { userId: active.userId });
  return { ok: true, removedName };
}

export type SignOutOthersResult =
  | { ok: true; sessions: SessionEntry[] }
  | { ok: false; error: 'SESSION_EXPIRED' | 'SUDO_REQUIRED' };

/**
 * Sudo-gated, TRUE cross-device sign-out. Cookie entries are deleted with their
 * tokens exactly as before; an additive, wholly best-effort sweep then deletes the user's
 * remaining provider-side sessions (other devices) via the privileged token-less port
 * method. The active session is never deleted. Sweep failures never block the redirect.
 */
export async function signOutOtherSessions(
  provider: AuthProvider,
  sessions: SessionEntry[],
  input: { nowMs: number }
): Promise<SignOutOthersResult> {
  const active = await resolveActive(provider, sessions);
  if (!active) return { ok: false, error: 'SESSION_EXPIRED' };

  if (!isSudoFresh(active.factors, input.nowMs)) {
    logAuthEvent('logout', 'failure', {
      actor: hashActor(active.entry.loginName),
      reason: 'sudo_required',
    });
    return { ok: false, error: 'SUDO_REQUIRED' };
  }

  // Cookie loop (original semantics, unchanged): delete every non-active cookie entry
  // with its token, best-effort each.
  const others = sessions.filter((s) => s.id !== active.entry.id);
  await Promise.all(
    others.map(async (entry) => {
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
        // best-effort — never blocks the offer
      }
    })
  );

  // Cross-device sweep: sessions on OTHER devices are invisible to the cookie —
  // search provider-side and delete all but the active one. Cookie-attempted ids are
  // excluded (a token-path failure is not retried; NOT_FOUND swallows cover races).
  try {
    const attempted = new Set([active.entry.id, ...others.map((o) => o.id)]);
    const userSessions = await provider.listUserSessions(active.userId);
    await Promise.all(
      userSessions
        .filter((s) => !attempted.has(s.id))
        .map(async (s) => {
          try {
            await provider.deleteUserSession(s.id);
            logAuthEvent('logout', 'success', { userId: active.userId, sessionId: s.id });
          } catch (err) {
            logAuthEvent('logout', 'failure', {
              sessionId: s.id,
              reason: err instanceof Error ? err.message : String(err),
            });
            // best-effort — an unreachable session must not block the rest
          }
        })
    );
  } catch (err) {
    logAuthEvent('logout', 'failure', {
      userId: active.userId,
      reason: err instanceof Error ? err.message : String(err),
    });
    // Search failure — cookie-scoped behavior above already applied; never blocks.
  }

  return { ok: true, sessions: [active.entry] };
}
