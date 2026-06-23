import { providerForRequest } from '@/server/composition';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const req = (headers: Record<string, string> = {}) =>
  new Request('https://auth.example.test/id/login', { headers });

describe('composition root + transport-leak removal', () => {
  it('selects the fake provider when AUTH_PROVIDER=fake', () => {
    const prev = process.env.AUTH_PROVIDER;
    process.env.AUTH_PROVIDER = 'fake';
    try {
      const p = providerForRequest(req());
      expect(p).toBeDefined();
      expect(typeof p.listSessions).toBe('function'); // satisfies the AuthProvider surface
    } finally {
      process.env.AUTH_PROVIDER = prev;
    }
  });

  it('the neutral server boundary no longer imports any zitadel module', () => {
    const src = readFileSync(join(process.cwd(), 'app/server/auth-context.server.ts'), 'utf-8');
    expect(src).not.toMatch(/providers\/zitadel/);
  });

  it('auth-context.server re-exports providerForRequest (route importers stay green)', async () => {
    const mod = await import('@/server/auth-context.server');
    expect(typeof mod.providerForRequest).toBe('function');
  });
});
