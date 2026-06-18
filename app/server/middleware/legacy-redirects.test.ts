import { legacyRedirectTarget } from './legacy-redirects';
import { describe, it, expect } from 'vitest';

describe('legacyRedirectTarget', () => {
  it('renames idp/link → sso/link and preserves the query string', () => {
    expect(legacyRedirectTarget('/ui/v2/login/idp/link', '?organization=acme')).toBe(
      '/id/sso/link?organization=acme'
    );
  });
  it('renames loginname → login', () => {
    expect(legacyRedirectTarget('/ui/v2/login/loginname', '')).toBe('/id/login');
  });
  it('renames register → signup', () => {
    expect(legacyRedirectTarget('/ui/v2/login/register', '')).toBe('/id/signup');
  });
  it('prefix-swaps device and preserves the query string', () => {
    expect(legacyRedirectTarget('/ui/v2/login/device', '?user_code=ABC')).toBe(
      '/id/device?user_code=ABC'
    );
  });
  it('maps the bare legacy login (and trailing slash) to the login index', () => {
    expect(legacyRedirectTarget('/ui/v2/login', '')).toBe('/id/login');
    expect(legacyRedirectTarget('/ui/v2/login/', '')).toBe('/id/login');
  });
  it('prefix-swaps a deeper known path', () => {
    expect(legacyRedirectTarget('/ui/v2/login/password', '')).toBe('/id/login/password');
  });
  it('falls back to the login index for an unknown legacy subpath', () => {
    expect(legacyRedirectTarget('/ui/v2/login/bogus', '')).toBe('/id/login');
    expect(legacyRedirectTarget('/ui/v2/login/idp/link/extra', '')).toBe('/id/login');
  });
  it('returns null for a non-legacy path', () => {
    expect(legacyRedirectTarget('/id/login', '')).toBeNull();
    expect(legacyRedirectTarget('/ui/v2/loginXYZ', '')).toBeNull();
  });
});
