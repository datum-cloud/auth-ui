// cypress/component/resources/otp/otp-verify.cy.ts
//
// cy.task node-spec port covering createOtpVerifyHandlers' loader guard-fail (otp-verify.ts
// ~line 110): no matching session for the loginName redirects to /login. Node-bound because the
// loader reads a signed `sessions` cookie off a real Request (Cookie header blocked in the
// browser by the Fetch spec).
import { callService } from '../../../support/node/call-service';

describe('otp-verify loader guard-fail — threads requestId/organization (regression: dead-end mid-ceremony)', () => {
  it('redirects to a bare /login when no session matches and no ceremony context is present', () => {
    callService({
      fn: 'otpVerifyLoader',
      provider: 'singleton',
      otpVerifyConfig: { channel: 'email', verifyPath: '/login/verify/email' },
      request: { url: 'http://localhost/id/login/verify/email?loginName=ghost@nowhere.test' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login');
    });
  });

  it('threads requestId/organization onto the /login bounce when the ceremony is in flight', () => {
    callService({
      fn: 'otpVerifyLoader',
      provider: 'singleton',
      otpVerifyConfig: { channel: 'email', verifyPath: '/login/verify/email' },
      request: {
        url:
          'http://localhost/id/login/verify/email?loginName=ghost@nowhere.test' +
          '&requestId=oidc_V2_123&organization=org-1',
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login?requestId=oidc_V2_123&organization=org-1');
    });
  });
});
