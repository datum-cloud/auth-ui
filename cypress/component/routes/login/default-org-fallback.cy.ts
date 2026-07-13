// cypress/component/routes/login/default-org-fallback.cy.ts
//
// Tests that the login loader does NOT redirect-inject the default org into the URL
// on a bare /login (no ?organization=). The default org fallback is DISPLAY-ONLY:
// resolveOrg still runs to scope branding/settings/IdPs reads, but the result is
// never written back into the URL. The ceremony org (what reaches findUser) stays
// explicitly undefined for a bare /login, enabling instance-wide user lookup.
import { callService } from '../../../support/node/call-service';

describe('login loader — default-org fallback is display-only (no URL injection)', () => {
  it('bare /login (no ?organization=) → NO redirect; settings/branding/IdPs loaded for default org', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login' },
      recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getBranding', 'getActiveIdPs'],
    }).then((v) => {
      // no injecting redirect — the bare URL must NOT produce a 302
      expect(v.response?.isResponse ?? false).to.equal(false);
      const status = v.response?.status ?? 200;
      expect(status).to.not.equal(302);

      // resolveOrg still consults the default org exactly once (for display reads)
      expect(v.calls?.getDefaultOrg).to.have.length(1);

      // display reads now happen on THIS request, scoped to the default org
      expect(v.calls?.getLoginSettings).to.have.length(1);
      expect((v.calls?.getLoginSettings ?? [])[0]?.[0]).to.equal('org-default-fake');
      expect(v.calls?.getBranding).to.have.length(1);
      expect(v.calls?.getActiveIdPs).to.have.length(1);
      expect((v.calls?.getActiveIdPs ?? [])[0]?.[0]).to.equal('org-default-fake');

      // IdPs are present in the loader data (singleton seeds Google + GitHub + LDAP)
      const idps = (v.response?.dataBody as { idps?: unknown[] } | undefined)?.idps ?? [];
      expect(idps.length).to.be.greaterThan(0);
    });
  });
});
