import { deviceDecision } from './device-decision';
import { describe, it, expect } from 'vitest';

const session = { id: 'sess-1', token: 'tok-1' };

describe('deviceDecision', () => {
  it('authorize with a session returns a {session} decision', () => {
    expect(deviceDecision({ decision: 'authorize', session })).toEqual({ session });
  });
  it('deny ignores any session and returns an empty decision', () => {
    expect(deviceDecision({ decision: 'deny', session })).toEqual({});
  });
  it('deny without a session also returns an empty decision', () => {
    expect(deviceDecision({ decision: 'deny' })).toEqual({});
  });
  it('authorize without a session throws (cannot authorize unauthenticated)', () => {
    expect(() => deviceDecision({ decision: 'authorize' })).toThrow(/session required/i);
  });
});
