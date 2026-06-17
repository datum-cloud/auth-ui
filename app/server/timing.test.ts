import { constantTimeNoop, CONSTANT_TIME_FLOOR_MS } from './timing';
import { describe, it, expect } from 'vitest';

describe('constantTimeNoop (CODE-MIN-17)', () => {
  it('waits the configured floor delay, not a single tick', async () => {
    const sleeps: number[] = [];
    const fakeSleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    await constantTimeNoop(fakeSleep);
    expect(CONSTANT_TIME_FLOOR_MS).toBeGreaterThan(0);
    expect(sleeps).toEqual([CONSTANT_TIME_FLOOR_MS]);
  });
});
