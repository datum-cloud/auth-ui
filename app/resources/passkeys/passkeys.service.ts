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
import { ProviderError, isStaleSessionError } from '@/modules/auth/types';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { validateReturnTo } from '@/resources/shared/return-to';
import { isSudoFresh } from '@/resources/shared/sudo';
import { usableSignInMethods } from '@/resources/shared/usable-methods';
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
  // The stored session token may belong to a DIFFERENT browser/tab than the one hitting this
  // route right now, and may be stale or revoked provider-side. getSession/findUser throw
  // (rather than returning null) when that's the case — treat any non-transient ProviderError
  // the same as a null session (return null; the caller already redirects to /login). A
  // genuinely transient error (real backend outage) still propagates.
  try {
    const session = await provider.getSession(entry.id, entry.token);
    if (!session) return null;
    const userId = session.user?.id ?? (await provider.findUser(entry.loginName))?.id;
    if (!userId) return null;
    return { entry, factors: session.factors, userId };
  } catch (err) {
    if (isStaleSessionError(err)) {
      logAuthEvent('passkeys', 'failure', {
        actor: hashActor(entry.loginName),
        reason: err instanceof ProviderError ? err.code : 'UNKNOWN',
      });
      return null;
    }
    throw err;
  }
}

/**
 * Loader view: requires a live session; stale sudo redirects to /reauth (UX check —
 * the actions re-enforce). Fresh sudo returns rows + methodCount (drives the
 * backup-method banner when == 1) + the validated returnTo.
 */
export async function loadPasskeysView(
  provider: AuthProvider,
  sessions: SessionEntry[],
  input: { returnTo: string | null; nowMs: number; emailDeliveryEnabled: boolean }
): Promise<PasskeysViewResult> {
  const active = await resolveActive(provider, sessions);
  if (!active) return { kind: 'redirect', target: paths.login.index() };

  if (!isSudoFresh(active.factors, input.nowMs)) {
    return { kind: 'redirect', target: reauthTarget() };
  }

  const [passkeys, methods, settings] = await Promise.all([
    provider.listPasskeys(active.userId),
    provider.listAuthMethods(active.userId),
    provider.getLoginSettings(await resolveOrg(provider, active.entry.organization)),
  ]);
  // methodCount drives the backup-method banner (shown when === 1) — must reflect
  // methods actually USABLE right now, not just enrolled (a policy-disabled method
  // is not a real backup).
  const usable = usableSignInMethods(methods, settings, input.emailDeliveryEnabled);

  return {
    kind: 'view',
    loginName: active.entry.loginName,
    userId: active.userId,
    passkeys,
    methodCount: usable.length,
    returnTo: validateReturnTo(input.returnTo),
  };
}

export type RemovePasskeyResult =
  | { ok: true; removedName: string | null }
  | { ok: false; error: 'SESSION_EXPIRED' | 'SUDO_REQUIRED' | 'LAST_METHOD' };

// Per-user in-process mutex for the last-method read-check-remove sequence below: two
// concurrent removals of DIFFERENT passkeys could otherwise both read "2 passkeys left,
// no other method" and both pass the guard, leaving zero sign-in methods. Zitadel's
// removePasskey has no conditional-delete primitive to make this atomic server-side, and
// this app has no external lock store — an in-process queue per userId is the realistic
// mitigation available here (closes the window for the common case: a double-click or
// two tabs hitting the SAME instance; a multi-instance deployment would need a real
// distributed lock, out of scope for this fix).
const userRemovalQueues = new Map<string, Promise<unknown>>();

function withUserRemovalLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prior = userRemovalQueues.get(userId) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  userRemovalQueues.set(userId, settled);
  void settled.finally(() => {
    if (userRemovalQueues.get(userId) === settled) userRemovalQueues.delete(userId);
  });
  return run;
}

/**
 * Sudo-gated passkey removal with the server-side last-method guard
 * (listAuthMethods IS Zitadel's listAuthenticationMethodTypes — refuse removing the
 * final sign-in method). NOT_FOUND from the adapter is idempotent success (removal race).
 */
export async function removeUserPasskey(
  provider: AuthProvider,
  sessions: SessionEntry[],
  input: { passkeyId: string; nowMs: number; emailDeliveryEnabled: boolean }
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

  const userId = active.userId;
  const organization = active.entry.organization;
  const emailDeliveryEnabled = input.emailDeliveryEnabled;
  return withUserRemovalLock(userId, async () => {
    const [passkeys, methods, settings] = await Promise.all([
      provider.listPasskeys(userId),
      provider.listAuthMethods(userId),
      provider.getLoginSettings(await resolveOrg(provider, organization)),
    ]);
    // Refuse removing the user's FINAL USABLE sign-in method: at most one passkey left
    // AND no other method that's both enrolled AND currently allowed by org/instance
    // policy — an enrolled-but-policy-disabled method (e.g. password auth turned off
    // after the user set one) is not a real backup.
    const usable = usableSignInMethods(methods, settings, emailDeliveryEnabled);
    if (passkeys.length <= 1 && !usable.some((m) => m !== 'passkey')) {
      logAuthEvent('passkey_remove', 'failure', {
        userId,
        reason: 'last_method',
      });
      return { ok: false, error: 'LAST_METHOD' };
    }

    const removedName = passkeys.find((p) => p.id === input.passkeyId)?.name ?? null;
    try {
      await provider.removePasskey(userId, input.passkeyId);
    } catch (err) {
      if (!(err instanceof ProviderError && err.code === 'NOT_FOUND')) {
        logAuthEvent('passkey_remove', 'failure', { userId });
        throw err;
      }
      // Removal race — the passkey is already gone; treat as success.
    }

    logAuthEvent('passkey_remove', 'success', { userId });
    return { ok: true, removedName };
  });
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
