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

// Both OTP loaders enforce the IDENTICAL guard-fail bounce contract, and otp-verify.cy.ts
// (now deleted) asserted exactly this shape against otpVerifyLoader. Merged here as one
// 4-row table: {enroll, verify} × {no ceremony context, mid-ceremony}.
const CEREMONY_QUERY = '&requestId=oidc_V2_123&organization=org-1';

const BOUNCES: Array<{
  label: string;
  scenario: Parameters<typeof callService>[0];
  expectedLocation: string;
}> = [
  {
    label: 'enroll, no ceremony context',
    scenario: {
      fn: 'otpEnrollLoader',
      provider: 'singleton',
      otpEnrollConfig: { verifyPath: '/login/verify/email' },
      request: { url: 'http://localhost/id/setup/email?loginName=ghost@nowhere.test' },
    },
    expectedLocation: '/login',
  },
  {
    label: 'enroll, ceremony in flight',
    scenario: {
      fn: 'otpEnrollLoader',
      provider: 'singleton',
      otpEnrollConfig: { verifyPath: '/login/verify/email' },
      request: {
        url: `http://localhost/id/setup/email?loginName=ghost@nowhere.test${CEREMONY_QUERY}`,
      },
    },
    expectedLocation: '/login?requestId=oidc_V2_123&organization=org-1',
  },
  {
    label: 'verify, no ceremony context',
    scenario: {
      fn: 'otpVerifyLoader',
      provider: 'singleton',
      otpVerifyConfig: { channel: 'email', verifyPath: '/login/verify/email' },
      request: { url: 'http://localhost/id/login/verify/email?loginName=ghost@nowhere.test' },
    },
    expectedLocation: '/login',
  },
  {
    label: 'verify, ceremony in flight',
    scenario: {
      fn: 'otpVerifyLoader',
      provider: 'singleton',
      otpVerifyConfig: { channel: 'email', verifyPath: '/login/verify/email' },
      request: {
        url: `http://localhost/id/login/verify/email?loginName=ghost@nowhere.test${CEREMONY_QUERY}`,
      },
    },
    expectedLocation: '/login?requestId=oidc_V2_123&organization=org-1',
  },
];

describe('otp enroll/verify loader guard-fail — threads requestId/organization (regression: dead-end mid-ceremony)', () => {
  it('bounces both loaders to /login, threading requestId/organization mid-ceremony', () => {
    for (const { label, scenario, expectedLocation } of BOUNCES) {
      callService(scenario).then((v) => {
        expect(v.response?.status, `${label}: status`).to.equal(302);
        expect(v.response?.location, `${label}: location`).to.equal(expectedLocation);
      });
    }
  });
});
