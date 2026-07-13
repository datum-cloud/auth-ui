// cypress/component/resources/otp/otp-enroll.cy.ts
//
// Component (no-mount) port of app/resources/otp/__tests__/otp-enroll.test.ts.
//
// The original drove createOtpEnrollHandlers.loader with a tampered `?force=garbage` query and a
// signed sessions cookie, asserting the loader does NOT 500 and degrades force→undefined. That
// graceful behavior is entirely a property of setupSkipSchema, which the loader applies as
// `setupSkipSchema.safeParse(...).success ? data : {}` — an invalid optional enum makes the parse
// fail, so the loader falls back to `{}` (force undefined). We pin that schema contract here
// (pure, browser-safe); the loader's session-guard + redirect wiring is covered by the
// setup-otp.cy.ts e2e (the no-session guard) and the cookie-bound otp.service.cy.ts specs.
import { callService } from '../../../support/node/call-service';
import { setupSkipSchema } from '@/resources/mfa/mfa.schema';

describe('setupSkipSchema — graceful tampered force/checkAfter params (otp-enroll loader guard)', () => {
  it('rejects a tampered force value so the loader degrades it to undefined (no 500)', () => {
    // The loader treats a failed parse as `{}` → force undefined. A throw here would be the 500.
    expect(setupSkipSchema.safeParse({ force: 'garbage' }).success).to.equal(false);
    expect(setupSkipSchema.safeParse({ force: 'garbage', checkAfter: 'true' }).success).to.equal(
      false
    );
  });
});

describe('otp-enroll loader guard-fail — threads requestId/organization (regression: dead-end mid-ceremony)', () => {
  it('redirects to a bare /login when no session matches and no ceremony context is present', () => {
    callService({
      fn: 'otpEnrollLoader',
      provider: 'singleton',
      otpEnrollConfig: { verifyPath: '/login/verify/email' },
      request: { url: 'http://localhost/id/setup/email?loginName=ghost@nowhere.test' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login');
    });
  });

  it('threads requestId/organization onto the /login bounce when the ceremony is in flight', () => {
    callService({
      fn: 'otpEnrollLoader',
      provider: 'singleton',
      otpEnrollConfig: { verifyPath: '/login/verify/email' },
      request: {
        url:
          'http://localhost/id/setup/email?loginName=ghost@nowhere.test' +
          '&requestId=oidc_V2_123&organization=org-1',
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login?requestId=oidc_V2_123&organization=org-1');
    });
  });
});
