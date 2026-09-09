// cypress/component/resources/signup/verification-resend.cy.ts
//
// CY-TASK: resendVerification drives the REAL provider, the REAL sendVerificationMail and the
// REAL audit sink, all node-bound.
//
// This helper exists because /recover's class-(d) branch and signup's resendIfSquatted must send
// the SAME mail to the SAME destination. Two copies would drift, and the drift would be invisible
// until a user recovering an unverified account landed somewhere signup never sends people. The
// spec asserts the destination precisely for that reason.
import { callService } from '../../../support/node/call-service';

const seed = {
  users: [{ id: 'u-1', loginName: 'owner@acme.test', orgId: 'org-1' }],
  authMethods: { 'u-1': [] as string[] },
};

const PORT = 58770;

describe('resendVerification — the one resend both doors use', () => {
  it('sends the signup verification mail to /signup/complete with next=passkey, and audits it', () => {
    callService({
      fn: 'resendVerification',
      seed,
      env: { VERIFICATION_MAIL_URL: `http://127.0.0.1:${PORT}/v1/email/verification` },
      resendUser: { id: 'u-1', loginName: 'owner@acme.test' },
      resendLink: { origin: 'http://localhost', requestId: 'req-9', organization: 'org-1' },
      verificationMailListen: true,
    }).then((v) => {
      expect(v.outcome.result).to.equal('sent');

      const received = (v.verificationMailReceived ?? [])[0];
      expect(received, 'the verification mail must have been posted').to.not.equal(undefined);
      const body = received?.body as { userId: string; returnTo: string; code: string };
      expect(body.userId).to.equal('u-1');
      // The destination is the contract: recovery's class-(d) user has to land where signup
      // would have put them, or the flow dead-ends after they verify.
      expect(body.returnTo).to.contain('/id/signup/complete');
      expect(body.returnTo).to.contain('next=passkey');
      expect(body.returnTo).to.contain('requestId=req-9');
      expect(body.returnTo).to.contain('organization=org-1');

      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('signup_verification_resent');
      expect(audit).to.contain('"outcome":"success"');
      // The code is a bearer credential; it travels in the POST body and nowhere else.
      expect(audit).to.not.contain(body.code);
    });
  });

  it("reports 'already_verified' and sends nothing when Zitadel refuses the resend", () => {
    callService({
      fn: 'resendVerification',
      seed: { ...seed, emailVerified: ['u-1'] },
      env: { VERIFICATION_MAIL_URL: `http://127.0.0.1:${PORT + 1}/v1/email/verification` },
      resendUser: { id: 'u-1', loginName: 'owner@acme.test' },
      resendLink: { origin: 'http://localhost' },
      verificationMailListen: true,
    }).then((v) => {
      // ALREADY_DONE is not an error here — it is the signal that this account is past
      // verification, which is what makes /recover fall through to a real recovery link.
      expect(v.outcome.result).to.equal('already_verified');
      expect((v.verificationMailReceived ?? []).length, 'nothing may be mailed').to.equal(0);
    });
  });

  it('does NOT rate-limit on its own — the caller owns the shared budget', () => {
    callService({
      fn: 'resendVerification',
      seed,
      env: { VERIFICATION_MAIL_URL: `http://127.0.0.1:${PORT + 2}/v1/email/verification` },
      resendUser: { id: 'u-1', loginName: 'owner@acme.test' },
      resendLink: { origin: 'http://localhost' },
      verificationMailListen: true,
      resendTwice: true,
    }).then((v) => {
      // Both calls send. allowResend lives in resendIfSquatted and requestRecovery so signup and
      // recovery draw on ONE per-address budget; a limiter in here would be a second one.
      expect(v.outcome.result).to.equal('sent');
      expect(v.outcome.second).to.equal('sent');
      expect((v.verificationMailReceived ?? []).length).to.equal(2);
    });
  });
});
