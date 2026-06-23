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

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms));

export async function constantTimeNoop(sleep: Sleep = realSleep): Promise<void> {
  await sleep(CONSTANT_TIME_FLOOR_MS);
}
