// cypress/component/resources/verify/verify-url-template.cy.ts
//
// Component (no-mount) port of app/resources/verify/__tests__/verify-url-template.test.ts.
// Pure URL template builder → browser-side Chai only.
//
// SECURITY: The verify link MUST be built from the trusted PUBLIC_ORIGIN (not the client Host
// header), and placeholders MUST stay as raw braces (Zitadel does NOT decode %7B%7B in email links).
import { verifyUrlTemplate } from '@/resources/verify/verify-url-template';

describe('verifyUrlTemplate', () => {
  it('builds an absolute /id/verify url with RAW (unencoded) provider placeholders', () => {
    const t = verifyUrlTemplate({ origin: 'https://auth.localtest.me:30000' });
    expect(t).to.equal(
      'https://auth.localtest.me:30000/id/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}'
    );
  });

  it('threads requestId (URL-encoded) when present', () => {
    const t = verifyUrlTemplate({ origin: 'https://h', requestId: 'oidc_9' });
    expect(t).to.contain('&requestId=oidc_9');
  });
});
