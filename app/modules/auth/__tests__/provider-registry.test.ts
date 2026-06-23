import { providerRegistry } from '@/modules/auth/select.server';
import { describe, it, expect } from 'vitest';

describe('providerRegistry — one binding point', () => {
  it('has exactly the fake and zitadel modes', () => {
    expect(Object.keys(providerRegistry).sort()).toEqual(['fake', 'zitadel']);
  });
  it('the fake entry returns a process-stable singleton', () => {
    const a = providerRegistry.fake({ AUTH_PROVIDER: 'fake' });
    const b = providerRegistry.fake({ AUTH_PROVIDER: 'fake' });
    expect(a).toBe(b);
  });
});
