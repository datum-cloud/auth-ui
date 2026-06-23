import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { describe, it, expect } from 'vitest';

describe('trustedAppOrigin', () => {
  it('returns the trusted publicOrigin and IGNORES the request Host (anti-injection)', () => {
    // SECURITY: even when the attacker spoofs the request Host (and thus the URL host),
    // the returned origin is the trusted config value — never the request host. This is
    // the property that closes the Host-header verification-link injection.
    const request = new Request('https://attacker.example/id/signup');
    const origin = trustedAppOrigin(request, 'https://auth.datum.net');
    expect(origin).toBe('https://auth.datum.net');
    expect(origin).not.toContain('attacker.example');
  });

  it('honors a non-https trusted origin verbatim (e.g. local dev)', () => {
    const request = new Request('http://evil.test/id/signup');
    expect(trustedAppOrigin(request, 'http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('falls back to the request origin when publicOrigin is undefined (dev/test/fake)', () => {
    // In dev/test/fake PUBLIC_ORIGIN is optional, so the request origin is the fallback.
    const request = new Request('http://localhost:3000/id/signup?x=1');
    expect(trustedAppOrigin(request, undefined)).toBe('http://localhost:3000');
  });
});
