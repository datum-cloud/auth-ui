import { TIMEOUTS } from '../timeouts';
import { describe, it, expect } from 'vitest';

describe('TIMEOUTS', () => {
  it('exposes a positive admin-check deadline in ms', () => {
    expect(TIMEOUTS.ADMIN_CHECK_MS).toBeGreaterThan(0);
    expect(TIMEOUTS.ADMIN_CHECK_MS).toBeLessThanOrEqual(30_000);
  });

  it('exposes a positive gRPC per-call deadline in ms', () => {
    expect(TIMEOUTS.GRPC_CALL_MS).toBeGreaterThan(0);
    expect(TIMEOUTS.GRPC_CALL_MS).toBeLessThanOrEqual(30_000);
  });
});
