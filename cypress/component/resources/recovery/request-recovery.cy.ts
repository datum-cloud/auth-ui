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
// What the stub webhook answers with on the sent path. The client parses this out of the 200 and
// the service seals it into the ticket, so it is the one value that proves auth-ui took the id
// from the WEBHOOK rather than minting one of its own.
const MINTED_CODE_ID = 'webhook-minted-code-id';
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
  it('asks the webhook to mint, and seals the codeId it gets back', () => {
    callService({
      fn: 'requestRecovery',
      seed: seedWithPasskey,
      env: envFor(PORT),
      recoveryInput: { email: EMAIL, organization: 'org-1', requestId: 'req-7' },
      verificationMailListen: true,
      verificationMailResponseBody: { codeId: MINTED_CODE_ID },
      // The inverted contract in one assertion: auth-ui must no longer mint a registration code
      // of its own. Without this the spec would pass on an implementation that minted one and
      // then threw it away.
      recordCalls: ['passkeyRegisterLink'],
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('sent');
      recordLength(v.outcome.ticket as string);
      expect(v.calls?.passkeyRegisterLink ?? [], 'auth-ui must not mint the code').to.have.length(
        0
      );

      const posts = v.verificationMailReceived ?? [];
      expect(posts.length, 'exactly one mail').to.equal(1);
      expect(posts[0].path).to.equal('/v1/email/recovery');
      // deep.equal: `codeId`/`code` in the request is a 400 by contract v2, so their ABSENCE is
      // the assertion, not a side effect of only checking the fields we happen to name.
      expect(posts[0].body).to.deep.equal({
        userId: 'u-1',
        requestedBy: 'self',
        returnTo: (posts[0].body as Record<string, string>).returnTo,
      });
      const body = posts[0].body as Record<string, string>;
      expect(body.returnTo).to.contain('/id/recover/complete');
      expect(body.returnTo).to.contain('organization=org-1');
      expect(body.returnTo).to.contain('requestId=req-7');

      // The ticket is sealed from the WEBHOOK's codeId — the whole point of the inversion.
      expect(v.outcome.opened, 'the ticket must open to the minted codeId').to.deep.equal({
        userId: 'u-1',
        codeId: MINTED_CODE_ID,
      });

      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('recovery_request');
      expect(audit).to.contain('"outcome":"sent"');
      // The address is hashed; the mail the webhook sent is the only place a code ever appears.
      expect(audit).to.not.contain(EMAIL);
    });
  });

  it('still answers identically when the webhook refuses — a filler, not a different response', () => {
    callService({
      fn: 'requestRecovery',
      seed: seedWithPasskey,
      env: envFor(PORT + 7),
      recoveryInput: { email: EMAIL, organization: 'org-1' },
      verificationMailListen: true,
      // The webhook's per-user cooldown (contract v2 §4). A live, recoverable account whose mail
      // was refused must not become distinguishable from one whose mail went out.
      verificationMailStatus: 429,
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('sent');
      // G7: the same fixed width as every sealed ticket and every other filler.
      recordLength(v.outcome.ticket as string);
      // There is no code to type, so the ticket seals nothing — and an unopenable ticket is
      // already what the typed-code path answers for a wrong code.
      expect(v.outcome.opened, 'a refused send seals no codeId').to.equal(null);
      expect((v.auditLines ?? []).join('\n')).to.contain('recovery_mail_failed');
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
      verificationMailResponseBody: { codeId: MINTED_CODE_ID },
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
      verificationMailResponseBody: { codeId: MINTED_CODE_ID },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('sent');
      recordLength(v.outcome.ticket as string);
      const posts = v.verificationMailReceived ?? [];
      expect(posts.length).to.equal(1);
      expect(posts[0].path).to.equal('/v1/email/recovery');
      expect(v.outcome.opened).to.deep.equal({ userId: 'u-1', codeId: MINTED_CODE_ID });
    });
  });
});
