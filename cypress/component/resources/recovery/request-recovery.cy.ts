// cypress/component/resources/recovery/request-recovery.cy.ts
//
// CY-TASK: requestRecovery drives the REAL provider, the REAL shared limiter, the REAL mail
// clients and the REAL sealed tickets — all node-bound.
//
// G7 IS THE SUBJECT OF THIS SPEC. Every row below asserts the ticket's LENGTH alongside the
// outcome, because the ticket is the only part of the /recover response that varies by account
// state, and a length difference is an enumeration oracle: it would tell an attacker which
// addresses exist. The outcome itself never reaches the browser — the route returns the same body
// for all of them (Task 8) — so these assertions are about the SIDE EFFECT and the TICKET only.
import { callService } from '../../../support/node/call-service';

const PORT = 58780;
const envFor = (port: number, opts: { recovery?: boolean } = { recovery: true }) => ({
  VERIFICATION_MAIL_URL: `http://127.0.0.1:${port}/v1/email/verification`,
  ...(opts.recovery === false
    ? {}
    : { RECOVERY_MAIL_URL: `http://127.0.0.1:${port}/v1/email/recovery` }),
});

const EMAIL = 'owner@acme.test';
const seedWithPasskey = {
  users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }],
  authMethods: { 'u-1': ['passkey'] },
};
const seedNoMethods = {
  users: [{ id: 'u-1', loginName: EMAIL, orgId: 'org-1' }],
  authMethods: { 'u-1': [] as string[] },
};

// Captured once and compared across every row: the fixed-length invariant only means something
// if the SAME number holds for a real ticket and every filler.
let ticketLength: number | undefined;
const recordLength = (t: string) => {
  if (ticketLength === undefined) ticketLength = t.length;
  expect(t.length, 'every ticket must be the same length (G7)').to.equal(ticketLength);
};

describe('requestRecovery — the account that can be recovered', () => {
  it('mails a passkey registration code and returns a REAL sealed ticket', () => {
    callService({
      fn: 'requestRecovery',
      seed: seedWithPasskey,
      env: envFor(PORT),
      recoveryInput: { email: EMAIL, organization: 'org-1', requestId: 'req-7' },
      verificationMailListen: true,
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('sent');
      recordLength(v.outcome.ticket as string);

      const posts = v.verificationMailReceived ?? [];
      expect(posts.length, 'exactly one mail').to.equal(1);
      expect(posts[0].path).to.equal('/v1/email/recovery');
      const body = posts[0].body as Record<string, string>;
      expect(body.userId).to.equal('u-1');
      expect(body.codeId, 'the codeId identifies which code').to.be.a('string').and.not.equal('');
      expect(body.code, 'the code itself travels only in the mail body')
        .to.be.a('string')
        .and.not.equal('');
      expect(body.requestedBy).to.equal('self');
      expect(body.returnTo).to.contain('/id/recover/complete');
      expect(body.returnTo).to.contain('organization=org-1');
      expect(body.returnTo).to.contain('requestId=req-7');

      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('recovery_request');
      expect(audit).to.contain('"outcome":"sent"');
      // Bearer credential: never in a log line, and the address is hashed.
      expect(audit).to.not.contain(body.code);
      expect(audit).to.not.contain(EMAIL);
    });
  });
});

describe('requestRecovery — the exits that must be silent (G7)', () => {
  it('suppresses an unknown address and mails nothing', () => {
    callService({
      fn: 'requestRecovery',
      seed: { users: [] },
      env: envFor(PORT + 1),
      recoveryInput: { email: 'nobody@acme.test' },
      verificationMailListen: true,
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('suppressed');
      recordLength(v.outcome.ticket as string);
      expect((v.verificationMailReceived ?? []).length).to.equal(0);
      expect((v.auditLines ?? []).join('\n')).to.contain('unknown_address');
    });
  });

  it('suppresses when the org forbids passkeys', () => {
    callService({
      fn: 'requestRecovery',
      seed: { ...seedWithPasskey, settingsByOrg: { 'org-1': { passkeysType: 'not_allowed' } } },
      env: envFor(PORT + 2),
      recoveryInput: { email: EMAIL, organization: 'org-1' },
      verificationMailListen: true,
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('suppressed');
      recordLength(v.outcome.ticket as string);
      expect((v.verificationMailReceived ?? []).length).to.equal(0);
      expect((v.auditLines ?? []).join('\n')).to.contain('org_policy');
    });
  });

  it('suppresses when RECOVERY_MAIL_URL is unset — delivery disabled, not an error', () => {
    callService({
      fn: 'requestRecovery',
      seed: seedWithPasskey,
      env: envFor(PORT + 3, { recovery: false }),
      recoveryInput: { email: EMAIL, organization: 'org-1' },
      verificationMailListen: true,
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('suppressed');
      recordLength(v.outcome.ticket as string);
      expect((v.verificationMailReceived ?? []).length).to.equal(0);
      expect((v.auditLines ?? []).join('\n')).to.contain('delivery_disabled');
    });
  });

  it('suppresses the second request inside the window, and shares the budget with signup', () => {
    callService({
      fn: 'requestRecoveryThenAllowResend',
      seed: seedWithPasskey,
      env: envFor(PORT + 4),
      recoveryInput: { email: EMAIL, organization: 'org-1' },
      verificationMailListen: true,
    }).then((v) => {
      expect(v.outcome.first).to.equal('sent');
      expect(v.outcome.second).to.equal('suppressed');
      recordLength(v.outcome.secondTicket as string);
      // Exactly one mail for two requests.
      expect((v.verificationMailReceived ?? []).length).to.equal(1);
      expect((v.auditLines ?? []).join('\n')).to.contain('rate_limited');
      // The SHARED budget: signup's resend form is now spent for this address too, so the two
      // forms cannot be combined to double the mail rate.
      expect(v.outcome.allowResendAfter, 'signup and recovery share one budget').to.equal(false);
    });
  });
});

describe('requestRecovery — class (d), the unverified signup', () => {
  it('resumes signup instead: the VERIFICATION mail, not a recovery link', () => {
    callService({
      fn: 'requestRecovery',
      seed: seedNoMethods,
      env: envFor(PORT + 5),
      recoveryInput: { email: EMAIL, organization: 'org-1' },
      verificationMailListen: true,
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('resumed_signup');
      recordLength(v.outcome.ticket as string);

      const posts = v.verificationMailReceived ?? [];
      expect(posts.length).to.equal(1);
      // Nothing to an unproven address except its OWN verification link.
      expect(posts[0].path).to.equal('/v1/email/verification');
      const body = posts[0].body as Record<string, string>;
      expect(body.returnTo).to.contain('/id/signup/complete');
      expect(body.returnTo).to.contain('next=passkey');

      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('signup_verification_resent');
      expect(audit).to.contain('"outcome":"resumed_signup"');
    });
  });

  it('falls through to a recovery link for the verified-but-methodless edge', () => {
    callService({
      fn: 'requestRecovery',
      // Verification succeeded but addOtpEmail did not: zero methods AND verified. Zitadel
      // refuses the resend, and that refusal is the signal to treat this as a real recovery.
      seed: { ...seedNoMethods, emailVerified: ['u-1'] },
      env: envFor(PORT + 6),
      recoveryInput: { email: EMAIL, organization: 'org-1' },
      verificationMailListen: true,
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('sent');
      recordLength(v.outcome.ticket as string);
      const posts = v.verificationMailReceived ?? [];
      expect(posts.length).to.equal(1);
      expect(posts[0].path).to.equal('/v1/email/recovery');
    });
  });
});
