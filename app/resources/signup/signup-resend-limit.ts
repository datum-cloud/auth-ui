import { RateLimiter } from '@/server/middleware/rate-limit';
import { hashActor } from '@/server/observability';

/** One resend per address per window. */
export const RESEND_WINDOW_MS = 5 * 60_000;
/** Hard ceiling per address per day, independent of the window above. */
export const RESEND_DAILY_CAP = 5;
const DAY_MS = 24 * 60 * 60_000;

// Two limiters, both keyed by a HASH of the address (never the address itself — these keys
// may reach Redis, and an audit-grade hash is what the audit log already uses for the same
// value). The short window bounds burst mail; the daily cap bounds a patient attacker who
// simply waits out each window.
let burst = new RateLimiter({ limit: 1, windowMs: RESEND_WINDOW_MS });
let daily = new RateLimiter({ limit: RESEND_DAILY_CAP, windowMs: DAY_MS });

/**
 * Whether a verification resend may be sent to `email` right now.
 *
 * SECURITY: a `false` return means SKIP THE SEND SILENTLY. The caller must return the exact
 * same response it would have returned on a successful send — G7 requires the response to be
 * byte-for-byte identical across every account state, so only the side effect may vary.
 *
 * Async despite a synchronous implementation: RateLimiter.check is synchronous and throws if
 * handed an async store, so this uses the default in-memory store — but the signature leaves
 * room to swap a Redis-backed store in without changing a single caller. In-memory state is
 * per-replica, matching every other limiter in this app.
 */
export async function allowResend(email: string, nowMs: number = Date.now()): Promise<boolean> {
  const key = hashActor(email.toLowerCase());
  // BURST FIRST, and the order is load-bearing. check() RECORDS a hit even when it denies, so
  // consulting `daily` first spends a daily slot on every request the burst window is about to
  // reject: six rapid submissions would send ONE mail and still exhaust the address's 24h
  // budget, locking its real owner out for the rest of the day. That hands an attacker a way to
  // keep squatting the very address this resend exists to free. Gate on the cheap window first,
  // so only a request that could actually send is allowed to spend a daily slot.
  if (!burst.check(key, nowMs).allowed) return false;
  return daily.check(key, nowMs).allowed;
}

/** Test seam — the limiters hold module-level state that must not leak between specs. */
export function _resetResendLimiterForTests(): void {
  burst = new RateLimiter({ limit: 1, windowMs: RESEND_WINDOW_MS });
  daily = new RateLimiter({ limit: RESEND_DAILY_CAP, windowMs: DAY_MS });
}
