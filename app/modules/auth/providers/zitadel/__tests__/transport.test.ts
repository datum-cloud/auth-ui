import { resolveServiceUrl, createServerTransport } from '../transport';
import { describe, it, expect, vi } from 'vitest';

// createServerTransport calls into @zitadel/client/node which requires a real Node.js
// HTTP/2 stack. Mock the library so tests remain unit-level and environment-agnostic.
vi.mock('@zitadel/client/node', () => ({
  createServerTransport: vi.fn((_token: string, opts: { baseUrl: string }) => ({
    __mockTransport: true,
    baseUrl: opts.baseUrl,
  })),
}));

// EL-TRANSPORT-1: resolveServiceUrl is fail-closed. x-zitadel-forward-host is accepted ONLY
// when its https-normalized value appears in trustedForwardHosts. Empty/unset list → reject all.
describe('resolveServiceUrl', () => {
  it('accepts x-zitadel-forward-host when allowlisted (https-normalized)', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'tenant.zitadel.test' });
    expect(
      resolveServiceUrl(h, {
        ZITADEL_API_URL: 'http://fallback',
        trustedForwardHosts: ['tenant.zitadel.test'],
      })
    ).toBe('https://tenant.zitadel.test');
  });
  it('accepts an already-https forward host when allowlisted', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'https://tenant.zitadel.test' });
    expect(resolveServiceUrl(h, { trustedForwardHosts: ['tenant.zitadel.test'] })).toBe(
      'https://tenant.zitadel.test'
    );
  });
  it('rejects x-zitadel-forward-host when NOT in allowlist (fail-closed)', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'evil.attacker.test' });
    expect(() =>
      resolveServiceUrl(h, {
        ZITADEL_API_URL: 'https://safe.test',
        trustedForwardHosts: ['tenant.zitadel.test'],
      })
    ).toThrow('Zitadel service URL could not be determined');
  });
  it('rejects x-zitadel-forward-host when trustedForwardHosts is empty (fail-closed)', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'tenant.zitadel.test' });
    expect(() =>
      resolveServiceUrl(h, { ZITADEL_API_URL: 'https://safe.test', trustedForwardHosts: [] })
    ).toThrow('Zitadel service URL could not be determined');
  });
  it('rejects x-zitadel-forward-host when trustedForwardHosts is absent (fail-closed default)', () => {
    const h = new Headers({ 'x-zitadel-forward-host': 'tenant.zitadel.test' });
    expect(() => resolveServiceUrl(h, { ZITADEL_API_URL: 'https://safe.test' })).toThrow(
      'Zitadel service URL could not be determined'
    );
  });
  it('falls back to ZITADEL_API_URL when no forward-host header present', () => {
    expect(resolveServiceUrl(new Headers(), { ZITADEL_API_URL: 'https://z.test' })).toBe(
      'https://z.test'
    );
  });
  it('throws when nothing resolves', () => {
    expect(() => resolveServiceUrl(new Headers(), {})).toThrow();
  });
});

describe('createServerTransport — caching', () => {
  // Each describe block gets a fresh module-level cache because vitest re-imports
  // the module per file but NOT per test. We rely on the fact that same-key calls
  // within one run return ===, and different-key calls return distinct objects.
  it('returns the same object reference for the same url+token (cache hit)', () => {
    const a = createServerTransport('tok', 'https://z.test');
    const b = createServerTransport('tok', 'https://z.test');
    expect(a).toBe(b);
  });
  it('returns a different object for a different baseUrl (distinct cache entry)', () => {
    const a = createServerTransport('tok', 'https://z.test');
    const b = createServerTransport('tok', 'https://other.test');
    expect(a).not.toBe(b);
  });
  it('throws when baseUrl is empty', () => {
    expect(() => createServerTransport('tok', '')).toThrow('No instance url found');
  });
  it('throws when token is empty', () => {
    expect(() => createServerTransport('', 'https://z.test')).toThrow('No service token found');
  });
});
