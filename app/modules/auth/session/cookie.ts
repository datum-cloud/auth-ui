import {
  capSessions,
  mostRecent,
  removeSession,
  addSession,
  listSessions,
  byId,
  byLoginName,
  tsMs,
  type SessionEntry,
} from './session';
import type { Session } from '@/modules/auth/types';
import { APP_BASENAME } from '@/resources/shared/app-basename';
import { env } from '@/server/infra/env.server';
import { logAuthEvent } from '@/server/observability';
import type { MiddlewareHandler } from 'hono';
import { createCookie } from 'react-router';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — mirrors SessionEntry exactly (P0 carry-over guard)
// ---------------------------------------------------------------------------

const EntrySchema = z.object({
  id: z.string(),
  token: z.string(),
  loginName: z.string(),
  organization: z.string().optional(),
  creationTs: z.string(),
  expirationTs: z.string(),
  changeTs: z.string(),
  requestId: z.string().optional(),
});

/**
 * Validates the parsed cookie payload.  Any wrong-shape entry or non-array
 * causes the whole cookie to collapse to [] rather than throwing — a cookie
 * we signed can never legitimately be malformed, so partial salvage would
 * only mask tampering.
 */
const SessionsSchema = z.array(EntrySchema);

// Browsers silently drop a Set-Cookie over ~4KB; keep a safe 2KB budget (spec §7).
const MAX_COOKIE_BYTES = 2048;

// Scoped to the app basename like every sibling cookie (csrf, last-used-login, passkey-hint,
// reauth-intent, idp-autostart). It used to be Path=/, so the session handles rode along on every
// request to the whole host, including apps that are not this one.
export const sessionsCookie = createCookie('sessions', {
  httpOnly: true,
  sameSite: 'lax',
  path: APP_BASENAME,
  secure: env.NODE_ENV === 'production',
  secrets: [env.SESSION_SECRET],
  maxAge: 60 * 60 * 24,
});

// ---------------------------------------------------------------------------
// One-release migration off the old Path=/ cookie
// ---------------------------------------------------------------------------
//
// MIGRATION — remove after 2027-01-31 (one release after the Path=/id change ships).
// A browser still holding the old root-scoped `sessions` cookie would send BOTH it and the new
// /id one, and the parser reads whichever comes first. Every response that sets the sessions
// cookie therefore also expires the root-scoped one. The cookie's maxAge is 24h, so any root
// cookie is gone a day after deploy whether or not it is cleared; the release window is margin.
// To remove: delete this block, the `legacyRootSessionsClear` mount in app/server.ts, and its
// spec in cypress/component/modules/auth/session/session-cookie-path.cy.ts.

/** Set-Cookie that expires a `sessions` cookie left over at Path=/. */
export function legacyRootSessionsClear(): string {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `sessions=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

/** True when the response sets the basename-scoped sessions cookie (and so should clear the old one). */
export function setsScopedSessionsCookie(setCookies: readonly string[]): boolean {
  const scoped = new RegExp(`;\\s*Path=${APP_BASENAME}(;|$)`, 'i');
  return setCookies.some((c) => c.startsWith('sessions=') && scoped.test(c));
}

/**
 * Hono middleware (mounted on '*' in app/server.ts): after the handler runs, if the response sets
 * the sessions cookie, append the Path=/ expiry. One mount covers every call site that writes the
 * cookie (sign-in, account switch, logout, IdP callbacks) without touching each of them.
 */
export const legacyRootSessionsClearMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  const res = c.res;
  if (!setsScopedSessionsCookie(res.headers.getSetCookie())) return;
  const headers = new Headers(res.headers);
  headers.append('set-cookie', legacyRootSessionsClear());
  // Reset first: assigning over an existing c.res makes Hono re-copy the old Set-Cookie list
  // onto the new response, which would drop the appended header.
  c.res = undefined;
  c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

export async function readSessions(request: Request): Promise<SessionEntry[]> {
  const cookieHeader = request.headers.get('cookie');
  const raw = await sessionsCookie.parse(cookieHeader);

  // Tamper signals (absent cookie header stays silent):
  // 1. header carries `sessions=` but HMAC verification failed → parse returns null
  // 2. HMAC verified but the payload shape is wrong → a cookie WE signed can never
  //    legitimately be malformed, so this is tampering or a secret-sharing bug.
  const headerHasSessionsCookie = cookieHeader !== null && cookieHeader.includes('sessions=');
  if (raw === null || raw === undefined) {
    if (headerHasSessionsCookie) {
      logAuthEvent('session_cookie', 'failure', { reason: 'invalid_signature' });
    }
    return [];
  }

  const parsed = SessionsSchema.safeParse(raw);
  if (!parsed.success) {
    logAuthEvent('session_cookie', 'failure', { reason: 'malformed_payload' });
    return [];
  }
  return parsed.data;
}

/**
 * Serialize the session list to a signed cookie string, capping at MAX_COOKIE_BYTES.
 *
 * `createCookie().serialize` is async (it produces an HMAC-signed payload), so byte
 * measurement must be async too. We run an async pre-pass that measures the real signed
 * payload size for each newest-k suffix of the list, then hand the lookup table to the
 * pure `capSessions` from `./session` as the `sizeOf` function — keeping `capSessions`
 * as the single eviction implementation in the codebase (spec §7).
 *
 * Pre-pass walk: start at k = list.length (all entries) and shrink k toward 0, breaking
 * as soon as the serialized size fits — smaller subsets can only be smaller, so no further
 * measurements are needed once we find a fitting k.
 */
export async function serializeSessions(list: SessionEntry[]): Promise<string> {
  // Async pre-pass: measure the REAL signed payload for each newest-k candidate list,
  // then let the pure capSessions pick the survivors via a lookup-based sizeOf.
  // changeTs is a string (numeric-epoch OR ISO-8601). Number(ISO) is NaN, which made this sort
  // a no-op — the "newest-k" pre-pass then measured an arbitrary subset, so the eviction size
  // table was computed over the wrong sessions and the emitted cookie could exceed the byte
  // budget or over-evict. tsMs parses both formats (shared with mostRecent/listSessions).
  const byNewest = [...list].sort((a, b) => tsMs(b.changeTs) - tsMs(a.changeTs));
  const sizeByLength = new Map<number, number>();
  for (let k = list.length; k >= 0; k--) {
    const candidate = [...byNewest.slice(0, k)].sort((a, b) => tsMs(a.changeTs) - tsMs(b.changeTs));
    const bytes = new TextEncoder().encode(await sessionsCookie.serialize(candidate)).byteLength;
    sizeByLength.set(k, bytes);
    if (bytes <= MAX_COOKIE_BYTES) break; // smaller suffixes can only be smaller; no need to measure them
  }
  const capped = capSessions(
    list,
    MAX_COOKIE_BYTES,
    (l) => sizeByLength.get(l.length) ?? Number.MAX_SAFE_INTEGER
  );
  return sessionsCookie.serialize(capped);
}

/**
 * Map a freshly-created/verified provider {@link Session} to the cookie's
 * {@link SessionEntry} shape. The provider Session carries no `loginName`
 * (it lives on the optional `user` and is elided on several flows for an RPC
 * saving), no `organization`, and no `requestId`, so those are supplied by the
 * caller via `overrides`. `creationTs`/`changeTs` both mirror `session.changedAt`
 * and `expirationTs` mirrors `session.expiresAt`, matching every creation site
 * verbatim. `token` defaults to `session.token`; pass `overrides.token` only when
 * the persisted token diverges from the session object handed in.
 *
 * NOTE: This is for CREATION sites only. Token-rotation/update sites spread an
 * existing `SessionEntry` (`{ ...entry, token, changeTs, expirationTs }`) and
 * must NOT use this builder — they preserve the prior entry's id/loginName/creationTs.
 */
export function sessionEntryFromSession(
  session: Pick<Session, 'id' | 'token' | 'changedAt' | 'expiresAt'>,
  overrides: {
    loginName: string;
    organization?: string;
    requestId?: string;
    token?: string;
  }
): SessionEntry {
  return {
    id: session.id,
    token: overrides.token ?? session.token,
    loginName: overrides.loginName,
    organization: overrides.organization,
    creationTs: session.changedAt,
    expirationTs: session.expiresAt,
    changeTs: session.changedAt,
    requestId: overrides.requestId,
  };
}

// Re-export helpers so route loaders/actions import from one place
export { mostRecent, removeSession, addSession, listSessions, byId, byLoginName, tsMs };
export type { SessionEntry };
