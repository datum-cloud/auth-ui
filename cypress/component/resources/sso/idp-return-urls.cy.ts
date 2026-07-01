// cypress/component/resources/sso/idp-return-urls.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/idp-return-urls.test.ts.
// idpReturnUrls is pure URL building (basename + requestId/link threading) → browser-side Chai.
import { idpReturnUrls, APP_BASENAME } from '@/resources/sso/idp-return-urls';

describe('idpReturnUrls', () => {
  it('includes the /id basename so the IdP broker redirect hits the real route (regression: 404)', () => {
    const { success, failure } = idpReturnUrls('http://localhost:3000', 'google');
    expect(success).to.equal('http://localhost:3000/id/sso/google/callback');
    expect(failure).to.equal('http://localhost:3000/id/sso/google/error');
    expect(success.startsWith(`http://localhost:3000${APP_BASENAME}/sso/`)).to.equal(true);
  });

  it('carries the requestId so the callback can resume /authorize (regression: stuck at /signed-in)', () => {
    const { success } = idpReturnUrls('http://localhost:3000', 'google', {
      requestId: 'oidc_V2_123',
      organization: 'org-1',
    });
    expect(success).to.equal(
      'http://localhost:3000/id/sso/google/callback?requestId=oidc_V2_123&organization=org-1'
    );
  });
});
