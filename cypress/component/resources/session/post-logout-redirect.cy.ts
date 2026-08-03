import { validatePostLogoutRedirect } from '@/resources/session/session-logout.service';

const req = (qs: string) => new Request(`https://auth.localtest.me:30000/id/logout${qs}`);
const ALLOW = ['http://localhost:3001'];

describe('validatePostLogoutRedirect', () => {
  it('allows an absolute URL whose origin is allowlisted', () => {
    expect(
      validatePostLogoutRedirect(req('?post_logout_redirect=http://localhost:3001/login'), ALLOW)
    ).to.equal('http://localhost:3001/login');
    // The RP may send either spelling; both are honored.
    expect(
      validatePostLogoutRedirect(
        req('?post_logout_redirect_uri=http://localhost:3001/login'),
        ALLOW
      )
    ).to.equal('http://localhost:3001/login');
  });

  // The reject half of the guard. Without these, nothing proved the allowlist was
  // load-bearing — a build that returned `target` unconditionally would have passed the
  // accept case alone. null means "not honored"; the caller falls back to /logout/success.
  const REJECTED: [label: string, query: string][] = [
    ['origin not on the allowlist', '?post_logout_redirect=https://evil.example/steal'],
    // Same host, different port/scheme — origin comparison must be exact, not substring.
    ['allowlisted host on a different port', '?post_logout_redirect=http://localhost:9999/login'],
    [
      'allowlisted host over a different scheme',
      '?post_logout_redirect=https://localhost:3001/login',
    ],
    // Zitadel's own default is a relative path, and it is NOT a route in this UI. new URL()
    // throws on it, so it must be rejected rather than redirected to.
    ['a relative path (Zitadel default /logout/done)', '?post_logout_redirect=/logout/done'],
    ['a protocol-relative authority', '?post_logout_redirect=//evil.example/steal'],
    ['a javascript: URL', '?post_logout_redirect=javascript:alert(1)'],
    ['no redirect parameter at all', ''],
    ['an empty redirect parameter', '?post_logout_redirect='],
  ];

  it('returns null for anything that is not an allowlisted absolute URL, so the caller falls back to /logout/success', () => {
    for (const [label, query] of REJECTED) {
      expect(validatePostLogoutRedirect(req(query), ALLOW), label).to.equal(null);
    }
  });
});
