import { NONCE } from 'hono/secure-headers';
import { describe, it, expect } from 'vitest';

describe('server/edge home (request-bound Hono code)', () => {
  it('exposes cspDirectives from the new edge path', async () => {
    const mod = await import('@/server/edge/secure-headers');
    expect(typeof mod.cspDirectives).toBe('function');
    expect(mod.cspDirectives(false).styleSrc).toContain(NONCE); // CSP nonce invariant survives the move
  });
  it('the old middleware path still resolves (shim)', async () => {
    const mod = await import('@/server/middleware/secure-headers');
    expect(typeof mod.cspDirectives).toBe('function');
  });
});
