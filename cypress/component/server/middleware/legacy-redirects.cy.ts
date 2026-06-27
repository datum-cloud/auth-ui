// cypress/component/server/middleware/legacy-redirects.cy.ts
// COMPONENT port of app/server/middleware/__tests__/legacy-redirects.test.ts
// Pure string → string mapper — no node deps.
import { legacyRedirectTarget } from '@/server/middleware/legacy-redirects';

describe('legacyRedirectTarget', () => {
  it('renames idp/link → sso/link and preserves the query string', () => {
    expect(legacyRedirectTarget('/ui/v2/login/idp/link', '?organization=acme')).to.equal(
      '/id/sso/link?organization=acme'
    );
  });

  it('renames loginname → login', () => {
    expect(legacyRedirectTarget('/ui/v2/login/loginname', '')).to.equal('/id/login');
  });

  it('renames register → signup', () => {
    expect(legacyRedirectTarget('/ui/v2/login/register', '')).to.equal('/id/signup');
  });

  it('prefix-swaps device and preserves the query string', () => {
    expect(legacyRedirectTarget('/ui/v2/login/device', '?user_code=ABC')).to.equal(
      '/id/device?user_code=ABC'
    );
  });

  it('maps the bare legacy login (and trailing slash) to the login index', () => {
    expect(legacyRedirectTarget('/ui/v2/login', '')).to.equal('/id/login');
    expect(legacyRedirectTarget('/ui/v2/login/', '')).to.equal('/id/login');
  });

  it('prefix-swaps a deeper known path', () => {
    expect(legacyRedirectTarget('/ui/v2/login/password', '')).to.equal('/id/login/password');
  });

  it('falls back to the login index for an unknown legacy subpath', () => {
    expect(legacyRedirectTarget('/ui/v2/login/bogus', '')).to.equal('/id/login');
    expect(legacyRedirectTarget('/ui/v2/login/idp/link/extra', '')).to.equal('/id/login');
  });

  it('returns null for a non-legacy path', () => {
    expect(legacyRedirectTarget('/id/login', '')).to.be.null;
    expect(legacyRedirectTarget('/ui/v2/loginXYZ', '')).to.be.null;
  });
});
