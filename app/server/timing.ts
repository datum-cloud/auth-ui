/**
 * Timing helpers for enumeration-safe flows.
 *
 * constantTimeNoop: used in password-reset to execute a comparable-cost code path for
 * known and unknown accounts. A single-tick yield (setTimeout(0)) left the
 * known/unknown branches distinguishable by latency. We now wait a fixed floor delay that
 * approximates the provider round-trip, closing the timing oracle. The sleep is injectable
 * so unit tests stay deterministic.
 */

// Floor chosen to dominate the dispatch-vs-noop delta without adding meaningful UX latency.
export const CONSTANT_TIME_FLOOR_MS = 150;

// Exported so other call-sites that need an injectable backoff (e.g. the authorize/signup
// eventual-consistency retries) share one canonical "real" implementation instead of each
// re-declaring `new Promise(setTimeout)`.
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms));

export async function constantTimeNoop(sleep: Sleep = realSleep): Promise<void> {
  await sleep(CONSTANT_TIME_FLOOR_MS);
}

export interface DeadlineOptions {
  sleep?: Sleep;
  now?: () => number;
  floorMs?: number;
}

/**
 * Wait until `startedAt + floorMs`, whatever the caller already spent getting here.
 *
 * constantTimeNoop is a FLOOR, not a deadline: it adds a fixed delay to one branch and measures
 * nothing. When the branch it is defending against is faster than the floor — the common case for
 * a healthy provider — the padded branch becomes reliably SLOWER, which inverts the channel rather
 * than closing it, and the two variances stay separable.
 *
 * A deadline collapses both: stamp t0 on entry, call this before every exit, and every branch
 * leaves at the same wall-clock mark. The residual channel is only the tail where the real work
 * already overran the floor.
 *
 * `sleep`/`now`/`floorMs` are injectable so the arithmetic is testable without a wall clock.
 */
export async function waitUntilDeadline(
  startedAt: number,
  { sleep = realSleep, now = Date.now, floorMs = CONSTANT_TIME_FLOOR_MS }: DeadlineOptions = {}
): Promise<void> {
  await sleep(Math.max(0, floorMs - (now() - startedAt)));
}
