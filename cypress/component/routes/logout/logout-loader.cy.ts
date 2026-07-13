// cypress/component/routes/logout/logout-loader.cy.ts
//
// CY-TASK: logout route loader — logout_token branch (OIDC logout → 302).
// Migrated from: app/routes/logout/__tests__/logout-loader.test.ts
//
// The real completeOidcLogout does NOT validate the JWT logout_token — it only reads the
// sessions cookie and calls provider.deleteSession (best-effort). With an empty sessions
// cookie (no liveSessions seed), it still returns a valid outcome → logoutOutcomeToResponse
// produces a 302 Response. This is the fidelity-safe path for the cy.task migration.
import { callService } from '../../../support/node/call-service';

const BASE = 'http://localhost/id/logout';

describe('logout loader', () => {
  it('logout_token present → completes OIDC logout (302), does not render confirm page', () => {
    callService({
      fn: 'logoutLoader',
      request: {
        url: `${BASE}?logout_token=fake-jwt&post_logout_redirect_uri=http%3A%2F%2Flocalhost%2Fdone`,
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
    });
  });
});
