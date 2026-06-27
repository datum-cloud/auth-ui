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

  it('sets link=true for the account-linking flow', () => {
    const { success } = idpReturnUrls('https://auth.example', 'github', { link: true });
    expect(success).to.equal('https://auth.example/id/sso/github/callback?link=true');
  });

  it('combines link + requestId in the callback query', () => {
    const { success } = idpReturnUrls('http://localhost:3000', 'google', {
      link: true,
      requestId: 'oidc_V2_9',
    });
    expect(success).to.equal(
      'http://localhost:3000/id/sso/google/callback?link=true&requestId=oidc_V2_9'
    );
  });

  it('carries an idpId fallback slug through unchanged (idpTypeToSlug miss)', () => {
    const { success } = idpReturnUrls('http://localhost:3000', '377177363051446323');
    expect(success).to.equal('http://localhost:3000/id/sso/377177363051446323/callback');
  });
});
