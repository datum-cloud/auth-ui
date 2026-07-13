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

  it('falls back to the login index for unknown/malformed legacy subpaths, and returns null for non-legacy paths', () => {
    expect(legacyRedirectTarget('/ui/v2/login/bogus', '')).to.equal('/id/login');
    expect(legacyRedirectTarget('/ui/v2/login/idp/link/extra', '')).to.equal('/id/login');
    expect(legacyRedirectTarget('/id/login', '')).to.be.null;
    expect(legacyRedirectTarget('/ui/v2/loginXYZ', '')).to.be.null;
  });
});
