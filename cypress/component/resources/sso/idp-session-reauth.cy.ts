// cypress/component/resources/sso/idp-session-reauth.cy.ts
//
// cy.task node-spec port of app/resources/sso/__tests__/idp-session.reauth.test.ts.
// SECURITY-CRITICAL re-auth identity guard: signInWithIdpIntent reads the signed `reauth-intent`
// cookie and serializes the `sessions` cookie — node-bound. When a sign-in re-authenticates a
// specific account, the IdP-vouched fallbackLoginName must match the stored intent; a MISMATCH
// must bounce to /accounts (keep both accounts) rather than continue as the wrong identity.
import { callService, type Scenario } from '../../../support/node/call-service';

type SignInResult = { setCookie?: string; target?: string; reauthClearCookie?: string };
const opts = (fallbackLoginName: string, requestId = 'oidc_x'): Scenario['signInOpts'] => ({
  idpIntentId: 'i1',
  idpIntentToken: 't1',
  userId: 'u1',
  fallbackLoginName,
  requestId,
});
const URL = 'http://localhost/id/sso/google/callback';

describe('signInWithIdpIntent — re-auth identity guard', () => {
  it('matching re-auth → continues the ceremony (hand-back) and clears the intent', () => {
    callService({
      fn: 'signInWithIdpIntent',
      seed: {},
      signInOpts: opts('alice@acme.test'),
      request: { url: URL, reauthIntent: 'alice@acme.test' },
    }).then((v) => {
      const r = v.outcome as SignInResult;
      expect(r.target).to.include('/authorize');
      expect(r.target).to.not.include('reauthMismatch');
      expect(r.reauthClearCookie ?? '').to.include('reauth-intent=');
    });
  });

  it('mismatched re-auth → bounces to /accounts (reauthMismatch), keeps both, clears the intent', () => {
    callService({
      fn: 'signInWithIdpIntent',
      seed: {},
      signInOpts: opts('bob@acme.test'),
      request: { url: URL, reauthIntent: 'alice@acme.test' },
    }).then((v) => {
      const r = v.outcome as SignInResult;
      expect(r.target).to.include('/accounts');
      expect(r.target).to.include('reauthMismatch=1');
      expect(r.target).to.not.include('/authorize');
      expect(r.target).to.include('requestId=oidc_x');
      expect(r.reauthClearCookie ?? '').to.include('reauth-intent=');
      expect(r.setCookie).to.include('sessions=');
    });
  });
});
