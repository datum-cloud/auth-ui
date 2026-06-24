/**
 * Shared helper: exchange a resolved IdP intent for a new session cookie.
 *
 * Extracted from the 'sign-in' branch of sso.$provider.callback.tsx so the
 * LDAP credential route (sso.ldap.tsx) can reuse the identical sequence without
 * duplicating it. The 'link' case in the callback has an extra addIdpLink() call
 * before creating the session — it intentionally does NOT use this helper to
 * avoid coupling unrelated logic.
 *
 * Returns the set-cookie header value and the redirect target URL so the caller
 * can perform the redirect with the cookie in one response.
 */
import type { AuthProvider, SessionOpts } from '@/modules/auth/auth-provider';
import {
  addSession,
  readSessions,
  sessionEntryFromSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import type { Session, User } from '@/modules/auth/types';
import { authorizeHandbackTarget } from '@/resources/shared/next-step-params';

// ── Request-scoped provider-read cache ─────────────────────────────
//
// The SSO callback/link path issues several read-only RPCs (getUser, getSession,
// getLoginSettings, findUser). Without coordination a single request can re-issue an
// OVERLAPPING lookup (e.g. the same userId resolved twice across decision branches),
// each a network round-trip to Zitadel. This memoizes those reads for the lifetime of
// ONE Request and no longer.
//
// SECURITY / CONCURRENCY: the cache is keyed by the `Request` object via a module-level
// WeakMap, so it is STRICTLY request-scoped — a different request is a different key and
// gets a fresh cache; the entry is garbage-collected with the request. It never bleeds
// across requests, so two concurrent users can never read each other's lookups. Only
// read-only lookups are cached (never createSession / addIdpLink / register / mutations).
// We cache the in-flight Promise (not just the resolved value) so two parallel awaits of
// the same key still collapse to one RPC.

interface RequestScopedProviderReads {
  getUser(id: string): Promise<User | null>;
  getSession(id: string, token: string): Promise<Session | null>;
}

type ReadCache = Map<string, Promise<unknown>>;
const requestReadCaches = new WeakMap<Request, ReadCache>();

function cacheFor(request: Request): ReadCache {
  let cache = requestReadCaches.get(request);
  if (!cache) {
    cache = new Map();
    requestReadCaches.set(request, cache);
  }
  return cache;
}

/**
 * Returns a memoized facade over the provider's read-only lookups, scoped to a single
 * `request`. Repeated lookups with identical arguments within that request collapse to
 * one underlying RPC (behavior-preserving: same resolved value). The cache is discarded
 * with the request — never shared across requests.
 */
export function requestScopedProviderReads(
  provider: AuthProvider,
  request: Request
): RequestScopedProviderReads {
  const cache = cacheFor(request);
  const memo = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const existing = cache.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const pending = load();
    cache.set(key, pending as Promise<unknown>);
    return pending;
  };
  return {
    getUser: (id) => memo(`getUser:${id}`, () => provider.getUser(id)),
    getSession: (id, token) =>
      memo(`getSession:${id}:${token}`, () => provider.getSession(id, token)),
  };
}

export interface SignInWithIdpIntentOpts {
  /** The resolved intent id (from startLdapIntent or the callback query param). */
  idpIntentId: string;
  /** The intent token. */
  idpIntentToken: string;
  /** Zitadel user id — session creation metadata (createSession `userId`). */
  userId: string;
  /** OIDC/device requestId; when present the redirect goes to /authorize. */
  requestId?: string;
  /** Org id forwarded to createSession. */
  organization?: string;
  /**
   * The loginName written to the session cookie (display/last-used hint). The callback
   * passes the IdP-vouched `idpUserName`; LDAP passes the entered username. This is now
   * the sole source — the redundant getUser lookup it used to fall back from is gone.
   */
  fallbackLoginName?: string;
  userAgent?: SessionOpts['userAgent'];
}

export interface SignInWithIdpIntentResult {
  /** The value to set as the 'set-cookie' response header. */
  setCookie: string;
  /** The URL to redirect to after sign-in. */
  target: string;
}

export async function signInWithIdpIntent(
  provider: AuthProvider,
  request: Request,
  opts: SignInWithIdpIntentOpts
): Promise<SignInWithIdpIntentResult> {
  const {
    idpIntentId,
    idpIntentToken,
    userId,
    requestId,
    organization,
    fallbackLoginName,
    userAgent,
  } = opts;

  const session = await provider.createSession(
    { idpIntent: { idpIntentId, idpIntentToken } },
    { requestId, orgId: organization, userId, userAgent }
  );

  // The post-create getUser(userId) lookup is elided. The only value it read was
  // `loginName`, and every caller already supplies it via `fallbackLoginName` — the callback
  // passes `intent.information.idpUserName` (the IdP-vouched login name) and LDAP passes the
  // entered username. The cookie's loginName is a display/last-used hint, so this is
  // behavior-identical while saving one RPC per sign-in.
  const loginName = fallbackLoginName ?? '';

  const entries = await readSessions(request);
  const next = addSession(
    entries,
    sessionEntryFromSession(session, { loginName, organization, requestId })
  );

  const setCookie = await serializeSessions(next);
  // Thread the just-created session id so /authorize finishes the callback via resolveOidc's
  // explicit-sessionId hand-back (runCallback) instead of re-running decideAuthorize — without
  // it a prompt=select_account / prompt=login ceremony loops straight back to /accounts (or
  // /login). Mirrors the password path's /authorize?requestId&sessionId hand-back. device_
  // requestIds intentionally never reach here as /authorize (they go via /signed-in).
  const target = authorizeHandbackTarget(requestId, session.id);

  return { setCookie, target };
}
