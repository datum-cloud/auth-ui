// cypress/component/routes/setup/authenticator-guard.cy.ts
//
// CY-TASK: /setup/authenticator loader — broken-session guard.
// Migrated from: app/routes/setup/__tests__/authenticator-guard.test.ts
//
// No sessions cookie → byLoginName returns undefined → loader redirects to /login.
// With requestId/organization in URL → redirect preserves ceremony params so mid-OIDC
// users return to the relying party instead of dead-ending at the default post-login page.
import { callService } from '../../../support/node/call-service';

const BASE = 'http://localhost/id/setup/authenticator';

const GUARD_ROWS = [
  {
    label: 'WITHOUT requestId → bare /login',
    url: `${BASE}?loginName=alice%40acme.test`,
    expectedLocation: '/login',
  },
  {
    label: 'WITH requestId → preserves requestId + organization',
    url: `${BASE}?loginName=alice%40acme.test&requestId=rq1&organization=acme`,
    expectedLocation: '/login?requestId=rq1&organization=acme',
  },
] as const;

describe('/setup/authenticator loader — broken-session guard', () => {
  it('no active session → redirect to /login, preserving ceremony params when present', () => {
    GUARD_ROWS.forEach(({ label, url, expectedLocation }) => {
      callService({
        fn: 'setupAuthenticatorLoader',
        request: { url },
      }).then((v) => {
        expect(v.error, `${label}: error`).to.be.undefined;
        expect(v.response!.isResponse, `${label}: isResponse`).to.be.true;
        expect(v.response!.status, `${label}: status`).to.equal(302);
        expect(v.response!.location, `${label}: location`).to.equal(expectedLocation);
      });
    });
  });
});
