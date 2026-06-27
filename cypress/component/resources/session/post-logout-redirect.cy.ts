import { validatePostLogoutRedirect } from '@/resources/session/session-logout.service';

const req = (qs: string) => new Request(`https://auth.localtest.me:30000/id/logout${qs}`);
const ALLOW = ['http://localhost:3001'];

describe('validatePostLogoutRedirect', () => {
  it("rejects Zitadel's relative /logout/done default (falls back to /logout/success)", () => {
    expect(validatePostLogoutRedirect(req('?post_logout_redirect=/logout/done'), ALLOW)).to.equal(
      null
    );
  });
  it('allows an absolute URL whose origin is allowlisted', () => {
    expect(
      validatePostLogoutRedirect(req('?post_logout_redirect=http://localhost:3001/login'), ALLOW)
    ).to.equal('http://localhost:3001/login');
  });
  it('rejects an absolute URL not on the allowlist (fail-closed)', () => {
    expect(
      validatePostLogoutRedirect(req('?post_logout_redirect=https://evil.com/x'), ALLOW)
    ).to.equal(null);
  });
  it('rejects protocol-relative //evil.com', () => {
    expect(validatePostLogoutRedirect(req('?post_logout_redirect=//evil.com'), ALLOW)).to.equal(
      null
    );
  });
  it('returns null when no redirect param is present', () => {
    expect(validatePostLogoutRedirect(req(''), ALLOW)).to.equal(null);
  });
  it('also reads the post_logout_redirect_uri param name', () => {
    expect(
      validatePostLogoutRedirect(
        req('?post_logout_redirect_uri=http://localhost:3001/login'),
        ALLOW
      )
    ).to.equal('http://localhost:3001/login');
  });
});
