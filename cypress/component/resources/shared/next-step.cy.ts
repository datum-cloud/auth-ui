// cypress/component/resources/shared/next-step.cy.ts
//
// Component (no-mount) port of app/resources/shared/__tests__/next-step.test.ts.
// Pure routing function (nextStep) → browser-side Chai only.
import type { Factors, LoginSettings } from '@/modules/auth/types';
import { nextStep } from '@/resources/shared/next-step';

const settings: LoginSettings = {
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: true,
  passkeysType: 'allowed',
  forceMfa: false,
};

const NOW = Date.parse('2026-01-01T00:00:00Z');

describe('nextStep', () => {
  const factors: Factors = { password: { verifiedAt: new Date('2026-01-01T00:00:00Z') } };

  it('routes to /signed-in when MFA is not forced, and to /setup/mfa?force=true when it is', () => {
    expect(nextStep({ factors, settings, nowMs: NOW }), 'not forced').to.equal('/signed-in');

    const forced = nextStep({
      factors,
      settings: { ...settings, forceMfa: true },
      nowMs: NOW,
      enrolledMethods: [],
      loginName: '',
      userVerified: false,
      mfaInitSkippedAt: null,
    });
    expect(forced, 'forced: path').to.contain('/setup/mfa');
    expect(forced, 'forced: force flag').to.contain('force=true');
    expect(forced, 'forced: checkAfter flag').to.contain('checkAfter=true');
  });
});

// ── Stale/missing primary factor: WHERE do we re-prompt? ───────────────────────
//
// This branch was an unconditional '/login/password'. That is a dead end for a passwordless
// account — it asks for a credential that does not exist, and the submit surfaces as
// SESSION_EXPIRED. It is reached routinely: an email-link signup (or magic-link login) session
// carries only an `otpEmail` factor, which `primaryFresh` does not count as primary.
describe('nextStep — re-prompt target when no primary factor is fresh', () => {
  // The exact shape produced by completeEmailLinkSignup: email ownership proven, nothing else.
  const otpEmailOnly: Factors = { otpEmail: { verifiedAt: new Date('2026-01-01T00:00:00Z') } };

  it('sends a passwordless passkey account to /login/passkey, never /login/password', () => {
    const target = nextStep({
      factors: otpEmailOnly,
      settings,
      nowMs: NOW,
      enrolledMethods: ['passkey', 'otp_email'],
      loginName: 'mia@acme.test',
    });
    expect(target, 'must not dead-end on a password the user never set').to.not.contain(
      '/login/password'
    );
    expect(target).to.contain('/login/passkey');
  });

  it('prefers /login/password when the account actually has a password', () => {
    const target = nextStep({
      factors: otpEmailOnly,
      settings,
      nowMs: NOW,
      enrolledMethods: ['password', 'passkey'],
      loginName: 'mia@acme.test',
    });
    expect(target).to.contain('/login/password');
  });

  it('falls back to the /login/method chooser when neither password nor passkey is enrolled', () => {
    const target = nextStep({
      factors: otpEmailOnly,
      settings,
      nowMs: NOW,
      enrolledMethods: ['otp_email', 'idp'],
      loginName: 'mia@acme.test',
    });
    expect(target).to.contain('/login/method');
  });

  // BACKWARD COMPATIBILITY: callers that pass no enrolment list must behave exactly as before.
  // A GHOST subject under `ignoreUnknownUsernames` arrives with GHOST_METHODS (['password']) and
  // is covered by the has-password case above — so both keep landing on /login/password, which is
  // what the anti-enumeration indistinguishability depends on.
  it('keeps the historical /login/password target when the enrolment list is unknown or empty', () => {
    for (const enrolledMethods of [undefined, []]) {
      const target = nextStep({
        factors: otpEmailOnly,
        settings,
        nowMs: NOW,
        enrolledMethods,
        loginName: 'mia@acme.test',
      });
      expect(target, `enrolledMethods=${JSON.stringify(enrolledMethods)}`).to.contain(
        '/login/password'
      );
    }
  });

  // The stale-password case the branch originally existed for must still re-prompt for password.
  it('still re-prompts for password when a real password factor has aged out', () => {
    const stale: Factors = { password: { verifiedAt: new Date('2025-12-31T00:00:00Z') } };
    const target = nextStep({
      factors: stale,
      settings: { ...settings, passwordCheckLifetimeMs: 60_000 },
      nowMs: NOW,
      enrolledMethods: ['password'],
      loginName: 'mia@acme.test',
    });
    expect(target).to.contain('/login/password');
  });
});
