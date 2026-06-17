import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { describe, it, expect } from 'vitest';

describe('getAuthProvider', () => {
  it('returns the FakeAuthProvider when AUTH_PROVIDER=fake', () => {
    const p = getAuthProvider({ AUTH_PROVIDER: 'fake' });
    expect(p).toBeInstanceOf(FakeAuthProvider);
  });
  it('constructs a Zitadel-backed provider otherwise without throwing', () => {
    expect(() =>
      getAuthProvider({ AUTH_PROVIDER: 'zitadel', serviceUrl: 'https://z.test' })
    ).not.toThrow();
  });
});
