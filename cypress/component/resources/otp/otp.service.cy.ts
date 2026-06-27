// cypress/component/resources/otp/otp.service.cy.ts
//
// cy.task node-spec port of the SESSION/CHALLENGE-bound otp tests:
//   - otp.service.test.ts  (dispatchEmailChallenge url_template; submitOtpCode 8-digit Bug B)
//   - otp-verify.test.ts   (createOtpVerifyHandlers loader challenge-dispatch matrix + resend)
//
// These drive the REAL fake singleton: dispatchEmailChallenge/submitOtpCode call provider methods
// (recorded via recordCalls), and the handler loader/action read a signed sessions cookie (+ a
// real CSRF round-trip for the action) off a Request — node-bound. The browser bundle stubs the
// cookie/observability modules, so the matrix can only be asserted node-side.
import { callService } from '../../../support/node/call-service';

const ALICE = 'alice@acme.test';
const EMAIL_USER = 'email-otp-user@acme.test';

describe('dispatchEmailChallenge — OTP-email LINK fix (Bug A)', () => {
  it('requests the otpEmail challenge with an url_template pointing at /id/login/verify/email', () => {
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
  });
});

describe('submitOtpCode — accepts 8- and 6-digit delivered codes (Bug B)', () => {
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

  (['email', 'sms'] as const).forEach((channel) => {
    it(`${channel}: accepts an 8-digit code and forwards it to the provider (not INVALID_INPUT)`, () => {
      run(channel, '86230120').then((v) => {
        const o = v.outcome as { ok: boolean; target?: string };
        expect(o.ok).to.equal(true);
        expect(typeof o.target).to.equal('string');
        const forwarded = (v.calls?.updateSession ?? [])
          .map((c) => (c[2] as Record<string, unknown>)[field(channel)])
          .filter((x): x is string => typeof x === 'string');
        expect(forwarded).to.include('86230120');
      });
    });

    it(`${channel}: still accepts a 6-digit code`, () => {
      run(channel, '123456').then((v) => {
        const forwarded = (v.calls?.updateSession ?? [])
          .map((c) => (c[2] as Record<string, unknown>)[field(channel)])
          .filter((x): x is string => typeof x === 'string');
        expect(forwarded).to.include('123456');
      });
    });
  });
});

// ── createOtpVerifyHandlers — loader challenge-dispatch matrix + session guard ────────────────

const emailConfig = {
  channel: 'email' as const,
  suppressChallengeOnCode: true,
  nextParamHandling: 'passkey-redirect' as const,
  writeLastUsedLogin: 'email' as const,
  verifyPath: '/login/verify/email',
};
const smsConfig = {
  channel: 'sms' as const,
  writeLastUsedLogin: false as const,
  verifyPath: '/login/verify/sms',
};
const authenticatorConfig = {
  channel: 'authenticator' as const,
  writeLastUsedLogin: false as const,
  verifyPath: '/login/verify/authenticator',
};

const emailLive = { id: 's1', token: 't1', user: { id: 'u3', loginName: EMAIL_USER } };
const emailCookie = [{ id: 's1', token: 't1', loginName: EMAIL_USER }];

describe('createOtpVerifyHandlers — loader session guard', () => {
  it('redirects to /login when there is no active session (no cookie)', () => {
    callService({
      fn: 'otpVerifyLoader',
      provider: 'singleton',
      otpVerifyConfig: emailConfig,
      request: { url: `http://localhost/id/login/verify/email?loginName=${EMAIL_USER}` },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login');
    });
  });
});

describe('createOtpVerifyHandlers — loader challenge dispatch matrix', () => {
  it('email: sends the challenge once on first arrival (no ?code)', () => {
    callService({
      fn: 'otpVerifyLoader',
      provider: 'singleton',
      otpVerifyConfig: emailConfig,
      liveSessions: [emailLive],
      request: {
        url: `http://localhost/id/login/verify/email?loginName=${EMAIL_USER}`,
        sessions: emailCookie,
      },
      recordCalls: ['updateSession'],
    }).then((v) => {
      expect(v.calls?.updateSession ?? []).to.have.length(1);
    });
  });

  it('email: suppresses the duplicate challenge AND prefills code on the ?code link path', () => {
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

  it('authenticator: sends no challenge (user reads the code from their app)', () => {
    callService({
      fn: 'otpVerifyLoader',
      provider: 'singleton',
      otpVerifyConfig: authenticatorConfig,
      liveSessions: [emailLive],
      request: {
        url: `http://localhost/id/login/verify/authenticator?loginName=${EMAIL_USER}`,
        sessions: emailCookie,
      },
      recordCalls: ['updateSession'],
    }).then((v) => {
      expect(v.calls?.updateSession ?? []).to.have.length(0);
    });
  });

  it('sms: sends a challenge on arrival', () => {
    callService({
      fn: 'otpVerifyLoader',
      provider: 'singleton',
      otpVerifyConfig: smsConfig,
      liveSessions: [emailLive],
      request: {
        url: `http://localhost/id/login/verify/sms?loginName=${EMAIL_USER}`,
        sessions: emailCookie,
      },
      recordCalls: ['updateSession'],
    }).then((v) => {
      expect((v.calls?.updateSession ?? []).length).to.be.at.least(1);
    });
  });
});

describe('createOtpVerifyHandlers — resend intent (action)', () => {
  it('redirects back to the verify path without ?code', () => {
    callService({
      fn: 'otpVerifyAction',
      provider: 'singleton',
      otpVerifyConfig: emailConfig,
      request: {
        url: 'http://localhost/id/login/verify/email',
        form: { intent: 'resend', loginName: EMAIL_USER },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc.startsWith('/login/verify/email?')).to.equal(true);
      expect(loc).to.include(`loginName=${encodeURIComponent(EMAIL_USER)}`);
      expect(loc).to.not.include('code=');
    });
  });
});
