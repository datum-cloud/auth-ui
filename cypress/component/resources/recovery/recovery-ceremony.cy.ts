// cypress/component/resources/recovery/recovery-ceremony.cy.ts
//
// CY-TASK: the ceremony reads a REAL sealed cookie off a REAL Request and drives the REAL
// provider — none of which exists in the browser bundle.
//
// The property under test is that the CEREMONY TICKET, not the form, decides whose passkey is
// being verified. This route family is session-less by design: the mailed code is the whole
// authorisation, so if the form could name the userId or passkeyId, anyone who reached the
// verify step could point it at another account. The ticket is sealed server-side and the form's
// passkeyId is only ever compared against it, never trusted.
import { callService } from '../../../support/node/call-service';

const seed = {
  users: [{ id: 'u-1', loginName: 'owner@acme.test', orgId: 'org-1' }],
  authMethods: { 'u-1': [] as string[] },
};

describe('startRecoveryCeremony — the code is the authorisation', () => {
  it('accepts the minted code and hands back creation options plus a sealed ceremony cookie', () => {
    callService({
      fn: 'startRecoveryCeremony',
      seed,
      mintPasskeyCode: 'u-1',
      recoveryStart: { userId: 'u-1', codeId: 'MINTED', code: 'MINTED', domain: 'localhost' },
    }).then((v) => {
      expect(v.outcome.ok).to.equal(true);
      expect(v.outcome.passkeyId).to.be.a('string').and.not.equal('');
      expect(v.outcome.publicKey, 'the browser needs the creation options').to.not.equal(undefined);
      expect(v.outcome.setCookie).to.be.a('string');
      expect(v.outcome.setCookie as string).to.contain('recovery_ceremony=');
      // The bearer credential must not survive into the cookie either; the ticket holds ids only.
      expect(v.outcome.setCookie as string).to.not.contain(v.outcome.minted as string);
    });
  });

  it('refuses a wrong code with one generic answer, and audits the stage', () => {
    callService({
      fn: 'startRecoveryCeremony',
      seed,
      mintPasskeyCode: 'u-1',
      recoveryStart: {
        userId: 'u-1',
        codeId: 'MINTED',
        code: 'definitely-not-the-code',
        domain: 'localhost',
      },
    }).then((v) => {
      expect(v.outcome.ok).to.equal(false);
      expect(v.outcome.error).to.equal('INVALID_CODE');
      expect(v.outcome.setCookie, 'a refused start sets no ceremony cookie').to.equal(undefined);
      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('recovery_complete');
      expect(audit).to.contain('"stage":"start"');
      expect(audit).to.contain('"path":"link"');
      expect(audit).to.contain('INVALID_CREDENTIALS');
    });
  });
});

describe('finishRecoveryCeremony — the ticket decides, not the form', () => {
  it('verifies the held credential, names the passkey, and returns the loginName to sign in with', () => {
    callService({
      fn: 'finishRecoveryCeremony',
      seed,
      recoveryPath: 'code',
      request: {
        url: 'http://localhost/id/recover',
        ceremonyTicket: { userId: 'u-1', passkeyId: 'pk-9' },
        form: {
          credential: '{"id":"cred-1"}',
          passkeyId: 'pk-9',
          passkeyName: 'Phone',
        },
      },
    }).then((v) => {
      expect(v.outcome.ok).to.equal(true);
      expect(v.outcome.loginName).to.equal('owner@acme.test');
      // The passkey really landed on the account, under the name the user typed.
      expect(v.outcome.passkeys).to.deep.equal([{ id: 'pk-9', name: 'Phone' }]);
      const audit = (v.auditLines ?? []).join('\n');
      expect(audit).to.contain('recovery_complete');
      expect(audit).to.contain('"path":"code"');
      expect(audit).to.contain('"outcome":"success"');
    });
  });

  it('is EXPIRED with no ceremony ticket at all', () => {
    callService({
      fn: 'finishRecoveryCeremony',
      seed,
      request: {
        url: 'http://localhost/id/recover',
        form: { credential: '{"id":"cred-1"}', passkeyId: 'pk-9' },
      },
    }).then((v) => {
      expect(v.outcome.ok).to.equal(false);
      expect(v.outcome.error).to.equal('EXPIRED');
    });
  });

  it("refuses a form passkeyId that differs from the ticket's — the form never overrides", () => {
    callService({
      fn: 'finishRecoveryCeremony',
      seed,
      request: {
        url: 'http://localhost/id/recover',
        ceremonyTicket: { userId: 'u-1', passkeyId: 'pk-9' },
        form: { credential: '{"id":"cred-1"}', passkeyId: 'pk-SOMEONE-ELSE' },
      },
    }).then((v) => {
      expect(v.outcome.ok).to.equal(false);
      expect(v.outcome.error).to.equal('INVALID_INPUT');
      expect(v.outcome.passkeys, 'nothing may be enrolled').to.deep.equal([]);
    });
  });

  it('is INVALID_INPUT when the credential is missing', () => {
    callService({
      fn: 'finishRecoveryCeremony',
      seed,
      request: {
        url: 'http://localhost/id/recover',
        ceremonyTicket: { userId: 'u-1', passkeyId: 'pk-9' },
        form: { passkeyId: 'pk-9' },
      },
    }).then((v) => {
      expect(v.outcome.ok).to.equal(false);
      expect(v.outcome.error).to.equal('INVALID_INPUT');
    });
  });
});
