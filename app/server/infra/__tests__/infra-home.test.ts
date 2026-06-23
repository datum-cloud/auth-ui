import { describe, it, expect } from 'vitest';

describe('server/infra home (framework-free, resource-importable)', () => {
  it('exposes env from the new infra path', async () => {
    const mod = await import('@/server/infra/env.server');
    expect(mod.env).toBeDefined();
  });
  it('exposes trustedAppOrigin from the new infra path', async () => {
    const mod = await import('@/server/infra/app-origin.server');
    expect(typeof mod.trustedAppOrigin).toBe('function');
  });
});
