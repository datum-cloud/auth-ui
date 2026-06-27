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

describe('/setup/authenticator loader — broken-session guard', () => {
  it('no active session WITHOUT requestId → redirect to bare /login', () => {
    callService({
      fn: 'setupAuthenticatorLoader',
      request: { url: `${BASE}?loginName=alice%40acme.test` },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
      expect(v.response!.location).to.equal('/login');
    });
  });

  it('no active session WITH requestId → redirect preserves requestId + organization', () => {
    callService({
      fn: 'setupAuthenticatorLoader',
      request: {
        url: `${BASE}?loginName=alice%40acme.test&requestId=rq1&organization=acme`,
      },
    }).then((v) => {
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
      expect(v.response!.location).to.equal('/login?requestId=rq1&organization=acme');
    });
  });

  it('no active session WITH requestId but no organization → redirect preserves requestId alone', () => {
    callService({
      fn: 'setupAuthenticatorLoader',
      request: { url: `${BASE}?loginName=alice%40acme.test&requestId=rq1` },
    }).then((v) => {
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
      expect(v.response!.location).to.equal('/login?requestId=rq1');
    });
  });
});
