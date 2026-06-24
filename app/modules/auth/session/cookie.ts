import {
  capSessions,
  mostRecent,
  removeSession,
  addSession,
  listSessions,
  byId,
  byLoginName,
  type SessionEntry,
} from './session';
import { env } from '@/server/infra/env.server';
import { logAuthEvent } from '@/server/observability';
import { createCookie } from 'react-router';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schema — mirrors SessionEntry exactly (P7 Task 8 Step 8: P0 carry-over guard)
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

export const sessionsCookie = createCookie('sessions', {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: env.NODE_ENV === 'production',
  secrets: [env.SESSION_SECRET],
  maxAge: 60 * 60 * 24,
});

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
  const byNewest = [...list].sort((a, b) => Number(b.changeTs) - Number(a.changeTs));
  const sizeByLength = new Map<number, number>();
  for (let k = list.length; k >= 0; k--) {
    const candidate = [...byNewest.slice(0, k)].sort(
      (a, b) => Number(a.changeTs) - Number(b.changeTs)
    );
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

// Re-export helpers so route loaders/actions import from one place
export { mostRecent, removeSession, addSession, listSessions, byId, byLoginName };
export type { SessionEntry };
