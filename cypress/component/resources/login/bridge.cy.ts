// cypress/component/resources/login/bridge.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/bridge.test.ts.
// shouldBridgeToAuthorize is a pure predicate → browser-side Chai only.
import { shouldBridgeToAuthorize } from '@/resources/login';

function params(search: string): URLSearchParams {
  return new URL(`http://localhost/id/login${search}`).searchParams;
}

// Only the `false` branch was covered, so a predicate hardwired to false would have passed
// while the OIDC and SAML bridges silently stopped firing — a dead protocol hop that no test
// would notice. Both true branches are distinct params, asserted separately.
const CASES: [label: string, search: string, expected: boolean][] = [
  ['an OIDC authRequest bridges', '?authRequest=oidc_V2_abc', true],
  ['a SAML samlRequest bridges', '?samlRequest=saml_abc', true],
  // The post-identifier return carries requestId, NOT authRequest — bridging here would
  // bounce the user back to /authorize and loop.
  ['the post-identifier ?requestId= return does NOT (no loop)', '?requestId=oidc_V2_abc', false],
  ['a bare /login does not bridge', '', false],
];

describe('/login → /authorize protocol bridge', () => {
  it('bridges on an OIDC authRequest or a SAML samlRequest, but never on the post-identifier requestId return', () => {
    for (const [label, search, expected] of CASES) {
      expect(shouldBridgeToAuthorize(params(search)), label).to.equal(expected);
    }
  });
});
