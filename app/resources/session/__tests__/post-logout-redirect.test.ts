import { validatePostLogoutRedirect } from '@/resources/session/session.service';
import { describe, it, expect } from 'vitest';

const req = (qs: string) => new Request(`https://auth.localtest.me:30000/id/logout${qs}`);
const ALLOW = ['http://localhost:3001'];

describe('validatePostLogoutRedirect', () => {
  it("rejects Zitadel's relative /logout/done default (falls back to /logout/success)", () => {
    expect(validatePostLogoutRedirect(req('?post_logout_redirect=/logout/done'), ALLOW)).toBeNull();
  });
  it('allows an absolute URL whose origin is allowlisted', () => {
    expect(
      validatePostLogoutRedirect(req('?post_logout_redirect=http://localhost:3001/login'), ALLOW)
    ).toBe('http://localhost:3001/login');
  });
  it('rejects an absolute URL not on the allowlist (fail-closed)', () => {
    expect(
      validatePostLogoutRedirect(req('?post_logout_redirect=https://evil.com/x'), ALLOW)
    ).toBeNull();
  });
  it('rejects protocol-relative //evil.com', () => {
    expect(validatePostLogoutRedirect(req('?post_logout_redirect=//evil.com'), ALLOW)).toBeNull();
  });
  it('returns null when no redirect param is present', () => {
    expect(validatePostLogoutRedirect(req(''), ALLOW)).toBeNull();
  });
  it('also reads the post_logout_redirect_uri param name', () => {
    expect(
      validatePostLogoutRedirect(req('?post_logout_redirect_uri=http://localhost:3001/login'), ALLOW)
    ).toBe('http://localhost:3001/login');
  });
});
