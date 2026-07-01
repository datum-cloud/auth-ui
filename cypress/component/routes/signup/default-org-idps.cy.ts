// cypress/component/routes/signup/default-org-idps.cy.ts
//
// Tests that both signup loaders pass the DEFAULT org (not undefined) to getActiveIdPs
// on a bare signup URL (no ?organization=). The IdP list is a DISPLAY read — it must use
// the same resolveOrg fallback as getLoginSettings/getBranding, exactly like login/index.tsx.
//
// WHY we assert the ARG rather than idps.length:
//   The fake provider's getActiveIdPs IGNORES the org arg (always returns its seeded IdPs),
//   so asserting idps.length > 0 would pass even with the bug. The only meaningful signal
//   is that getActiveIdPs is called with 'org-default-fake' (the resolved default org),
//   NOT with undefined (the raw URL org on a bare signup).
//
// Mirror of: cypress/component/routes/login/default-org-fallback.cy.ts
import { callService } from '../../../support/node/call-service';

describe('signup loaders — default-org fallback is display-only for IdP list', () => {
  it('signupIndexLoader: bare /signup (no ?organization=) → getActiveIdPs called with default org, not undefined', () => {
    callService({
      fn: 'signupIndexLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/signup?requestId=oidc_test123' },
      recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getActiveIdPs'],
    }).then((v) => {
      // no redirect — bare signup URL must NOT produce a 302
      expect(v.response?.isResponse ?? false).to.equal(false);
      const status = v.response?.status ?? 200;
      expect(status).to.not.equal(302);

      // resolveOrg consulted the default org exactly once (for display reads)
      expect(v.calls?.getDefaultOrg).to.have.length(1);

      // getLoginSettings scoped to the default org
      expect(v.calls?.getLoginSettings).to.have.length(1);
      expect((v.calls?.getLoginSettings ?? [])[0]?.[0]).to.equal('org-default-fake');

      // getActiveIdPs MUST also use the resolved default org — NOT undefined
      expect(v.calls?.getActiveIdPs).to.have.length(1);
      expect((v.calls?.getActiveIdPs ?? [])[0]?.[0]).to.equal('org-default-fake');
    });
  });

  it('signupMethodLoader: bare /signup/method (no ?organization=) → getActiveIdPs called with default org, not undefined', () => {
    callService({
      fn: 'signupMethodLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/method?loginName=test%40example.com&requestId=oidc_test123',
      },
      recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getActiveIdPs'],
    }).then((v) => {
      // no redirect
      expect(v.response?.isResponse ?? false).to.equal(false);
      const status = v.response?.status ?? 200;
      expect(status).to.not.equal(302);

      // resolveOrg consulted the default org
      expect(v.calls?.getDefaultOrg).to.have.length(1);

      // getLoginSettings scoped to the default org
      expect(v.calls?.getLoginSettings).to.have.length(1);
      expect((v.calls?.getLoginSettings ?? [])[0]?.[0]).to.equal('org-default-fake');

      // getActiveIdPs MUST also use the resolved default org — NOT undefined
      expect(v.calls?.getActiveIdPs).to.have.length(1);
      expect((v.calls?.getActiveIdPs ?? [])[0]?.[0]).to.equal('org-default-fake');
    });
  });
});
