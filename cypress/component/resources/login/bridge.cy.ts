// cypress/component/resources/login/bridge.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/bridge.test.ts.
// shouldBridgeToAuthorize is a pure predicate → browser-side Chai only.
import { shouldBridgeToAuthorize } from '@/resources/login';

function params(search: string): URLSearchParams {
  return new URL(`http://localhost/id/login${search}`).searchParams;
}

describe('/login → /authorize protocol bridge', () => {
  it('does NOT re-trigger on the post-identifier ?requestId= return (no loop)', () => {
    expect(shouldBridgeToAuthorize(params('?requestId=oidc_V2_abc'))).to.equal(false);
  });
});
