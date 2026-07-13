// cypress/component/routes/login/mfa-action-session-expired.cy.ts
//
// cy.task node-spec: login/mfa.tsx's action previously hard-redirected to
// paths.login.index() (dropping requestId/organization) on SESSION_EXPIRED. It now returns
// data({ error: 'SESSION_EXPIRED' }, { status: 400 }) so the route's existing
// useAuthActionRecovery inline banner fires — see login-recovery-render.cy.tsx for the
// render-side proof that the banner + "Sign in again" link threads requestId/organization.
// This spec proves the ACTION itself now produces that data shape instead of a redirect.
import { callService } from '../../../support/node/call-service';

describe('login/mfa action — SESSION_EXPIRED surfaces as inline data, not a hard redirect (regression: dropped requestId/organization)', () => {
  it('returns data({ error: SESSION_EXPIRED }) with status 400 instead of redirecting to /login', () => {
    callService({
      fn: 'loginMfaAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login/mfa',
        method: 'POST',
        csrf: true,
        form: {
          loginName: 'ghost@nowhere.test', // no matching session → SESSION_EXPIRED
          requestId: 'oidc_V2_123',
          organization: 'org-1',
          method: 'otp_email',
        },
      },
    }).then((v) => {
      // NOT a redirect — the old behavior was a 302 to a bare /login.
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(400);
      const body = v.response?.dataBody as Record<string, unknown>;
      expect(body.error).to.equal('SESSION_EXPIRED');
    });
  });
});
