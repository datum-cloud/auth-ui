// cypress/component/resources/otp/otp.service.cy.ts
//
// cy.task node-spec port of the SESSION/CHALLENGE-bound otp tests:
//   - otp.service.test.ts  (dispatchEmailChallenge url_template; submitOtpCode 8-digit Bug B)
//   - otp-verify.test.ts   (createOtpVerifyHandlers loader challenge-dispatch matrix)
//
// These drive the REAL fake singleton: dispatchEmailChallenge/submitOtpCode call provider methods
// (recorded via recordCalls), and the handler loader reads a signed sessions cookie off a Request
// — node-bound. The browser bundle stubs the cookie/observability modules, so the matrix can only
// be asserted node-side.
import { callService } from '../../../support/node/call-service';

const ALICE = 'alice@acme.test';
const EMAIL_USER = 'email-otp-user@acme.test';

const emailConfig = {
  channel: 'email' as const,
  suppressChallengeOnCode: true,
  nextParamHandling: 'passkey-redirect' as const,
  writeLastUsedLogin: 'email' as const,
  verifyPath: '/login/verify/email',
};

const emailLive = { id: 's1', token: 't1', user: { id: 'u3', loginName: EMAIL_USER } };
const emailCookie = [{ id: 's1', token: 't1', loginName: EMAIL_USER }];

describe('dispatchEmailChallenge (Bug A) + createOtpVerifyHandlers loader — email challenge dispatch', () => {
  it('requests the otpEmail challenge with an url_template pointing at /id/login/verify/email, and the loader suppresses a duplicate dispatch while prefilling the code from the link', () => {
    callService({
      fn: 'dispatchEmailChallenge',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/login/verify/email',
        sessions: [{ id: 's1', token: 't1', loginName: ALICE }],
      },
      emailChallengeInput: { origin: 'https://auth.datum.net', loginName: ALICE },
      recordCalls: ['updateSession'],
    }).then((v) => {
      const calls = v.calls?.updateSession ?? [];
      expect(calls).to.have.length(1);
      const checks = calls[0][2] as {
        challenges?: { otpEmail?: { kind?: string; urlTemplate?: string } };
      };
      const challenge = checks.challenges?.otpEmail;
      expect(challenge?.kind).to.equal('send-template');
      const urlTemplate = challenge?.urlTemplate ?? '';
      expect(urlTemplate).to.include('https://auth.datum.net/id/login/verify/email?');
      expect(urlTemplate).to.include('code={{.Code}}');
      expect(urlTemplate).to.include(`loginName=${encodeURIComponent(ALICE)}`);
      expect(urlTemplate).to.not.include('{{.OrgID}}'); // OTPEmail does not support OrgID
    });

    callService({
      fn: 'otpVerifyLoader',
      provider: 'singleton',
      otpVerifyConfig: emailConfig,
      liveSessions: [emailLive],
      request: {
        url: `http://localhost/id/login/verify/email?loginName=${EMAIL_USER}&code=86230120`,
        sessions: emailCookie,
      },
      recordCalls: ['updateSession'],
    }).then((v) => {
      expect(v.calls?.updateSession ?? []).to.have.length(0);
      expect((v.response?.dataBody as { code?: string })?.code).to.equal('86230120');
    });
  });
});

describe('submitOtpCode — accepts 8-digit delivered codes (Bug B)', () => {
  const run = (channel: 'email' | 'sms', code: string) =>
    callService({
      fn: 'submitOtpCode',
      provider: 'singleton',
      otpChannel: channel,
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: `http://localhost/id/login/verify/${channel}`,
        sessions: [{ id: 's1', token: 't1', loginName: ALICE }],
        form: { code, loginName: ALICE, csrf: 'x' },
      },
      recordCalls: ['updateSession'],
    });

  const field = (channel: 'email' | 'sms') => (channel === 'email' ? 'otpEmail' : 'otpSms');

  it('both channels accept an 8-digit code and forward it to the provider (not INVALID_INPUT)', () => {
    for (const channel of ['email', 'sms'] as const) {
      run(channel, '86230120').then((v) => {
        const o = v.outcome as { ok: boolean; target?: string };
        expect(o.ok, `${channel}: ok`).to.equal(true);
        expect(typeof o.target, `${channel}: target`).to.equal('string');
        const forwarded = (v.calls?.updateSession ?? [])
          .map((c) => (c[2] as Record<string, unknown>)[field(channel)])
          .filter((x): x is string => typeof x === 'string');
        expect(forwarded, `${channel}: code forwarded`).to.include('86230120');
      });
    }
  });
});
