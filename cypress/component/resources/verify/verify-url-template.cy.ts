// cypress/component/resources/verify/verify-url-template.cy.ts
//
// Component (no-mount) port of app/resources/verify/__tests__/verify-url-template.test.ts.
// Pure URL template builder → browser-side Chai only.
//
// SECURITY: The verify link MUST be built from the trusted PUBLIC_ORIGIN (not the client Host
// header), and placeholders MUST stay as raw braces (Zitadel does NOT decode %7B%7B in email links).
import { verifyUrlTemplate } from '@/resources/verify/verify-url-template';

describe('verifyUrlTemplate', () => {
  it('builds the verify url from the trusted origin with raw placeholders, threading requestId', () => {
    // Exact string: pins the trusted origin, the /id basename, and the raw placeholder braces
    // (Zitadel does NOT decode %7B%7B in email links).
    expect(verifyUrlTemplate({ origin: 'https://auth.localtest.me:30000' }), 'bare').to.equal(
      'https://auth.localtest.me:30000/id/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}'
    );

    expect(
      verifyUrlTemplate({ origin: 'https://h', requestId: 'oidc_9' }),
      'requestId threaded'
    ).to.contain('&requestId=oidc_9');
  });
});
