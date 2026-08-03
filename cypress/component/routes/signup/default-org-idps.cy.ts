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
import type { Scenario } from '../../../support/node/call-service';

// Both loaders must honor the same five-part contract on a bare signup URL; each row is a
// separate cy.task (its own Bun process + its own recorded-call arrays), differing only by
// {fn, url}. The row label prefixes every assertion so a failure names the exact loader.
const LOADERS: Array<{ label: string; fn: Scenario['fn']; url: string }> = [
  {
    label: 'signupIndexLoader bare /signup',
    fn: 'signupIndexLoader',
    url: 'http://localhost/id/signup?requestId=oidc_test123',
  },
  {
    label: 'signupMethodLoader bare /signup/method',
    fn: 'signupMethodLoader',
    url: 'http://localhost/id/signup/method?loginName=test%40example.com&requestId=oidc_test123',
  },
];

describe('signup loaders — default-org fallback is display-only for IdP list', () => {
  it('bare signup URLs (no ?organization=) → getActiveIdPs called with default org, not undefined', () => {
    LOADERS.forEach(({ label, fn, url }) => {
      callService({
        fn,
        provider: 'singleton',
        request: { url },
        recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getActiveIdPs'],
      }).then((v) => {
        // no redirect — bare signup URL must NOT produce a 302
        expect(
          v.response?.isResponse ?? false,
          `${label}: must not return a redirect Response`
        ).to.equal(false);
        const status = v.response?.status ?? 200;
        expect(status, `${label}: status must not be 302`).to.not.equal(302);

        // resolveOrg consulted the default org exactly once (for display reads)
        expect(v.calls?.getDefaultOrg, `${label}: getDefaultOrg call count`).to.have.length(1);

        // getLoginSettings scoped to the default org
        expect(v.calls?.getLoginSettings, `${label}: getLoginSettings call count`).to.have.length(
          1
        );
        expect(
          (v.calls?.getLoginSettings ?? [])[0]?.[0],
          `${label}: getLoginSettings org arg`
        ).to.equal('org-default-fake');

        // getActiveIdPs MUST also use the resolved default org — NOT undefined
        expect(v.calls?.getActiveIdPs, `${label}: getActiveIdPs call count`).to.have.length(1);
        expect((v.calls?.getActiveIdPs ?? [])[0]?.[0], `${label}: getActiveIdPs org arg`).to.equal(
          'org-default-fake'
        );
      });
    });
  });
});
