// cypress/component/routes/login/password-recaptcha-gate.cy.ts
//
// The password step runs the same reCAPTCHA gate as sign-up, under its own action name. A
// rejection answers before getLoginSettings and the password check, so it does no provider work
// and never counts against the account's failed attempts.
import { callService, type Verdict } from '../../../support/node/call-service';

const ALICE = 'alice@acme.test'; // u1, password 'hunter2' in the fake singleton
const URL = 'http://localhost/id/login/password';

// RECAPTCHA_SECRET_KEY requires PUBLIC_ORIGIN, whose hostname matches the fixtures' `hostname`.
const RECAPTCHA_ENV = {
  RECAPTCHA_SITE_KEY: 'test-site-key',
  RECAPTCHA_SECRET_KEY: 'test-secret-key',
  PUBLIC_ORIGIN: 'http://localhost:3000',
};

const ok = (over: Record<string, unknown> = {}) => ({
  success: true,
  score: 0.9,
  action: 'login_password',
  hostname: 'localhost',
  challenge_ts: new Date().toISOString(),
  ...over,
});

type ScoredEvent = { action?: string; verdict?: string; reason?: string; decision?: string };

const scoredEvent = (v: Verdict) =>
  v.audit?.find((a) => a.event === 'signup_recaptcha_scored') as ScoredEvent | undefined;

function submit(opts: {
  env?: Record<string, string>;
  recaptchaFetch?: { reject: true } | { body: Record<string, unknown> };
  token?: string;
}) {
  return callService({
    fn: 'loginPasswordAction',
    provider: 'singleton',
    env: opts.env ?? RECAPTCHA_ENV,
    ...(opts.recaptchaFetch ? { recaptchaFetch: opts.recaptchaFetch } : {}),
    recordCalls: ['getLoginSettings', 'updateSession'],
    liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
    request: {
      url: URL,
      sessions: [{ id: 's1', token: 't1', loginName: ALICE }],
      form: {
        loginName: ALICE,
        password: 'hunter2',
        ...(opts.token === undefined ? {} : { recaptchaToken: opts.token }),
      },
      csrf: true,
    },
  });
}

const expectRejected = (v: Verdict) => {
  expect(v.response?.dataStatus).to.equal(400);
  expect(v.response?.dataBody).to.have.property('error', 'RECAPTCHA_FAILED');
  expect(v.calls?.getLoginSettings ?? [], 'no provider work on a rejection').to.have.length(0);
  expect(v.calls?.updateSession ?? [], 'the password is never checked').to.have.length(0);
};

const expectPasswordChecked = (v: Verdict) => {
  expect(v.calls?.updateSession ?? [], 'the password check runs').to.have.length(1);
  expect(v.response?.status, 'signed in').to.equal(302);
};

describe('/login/password reCAPTCHA gate', () => {
  it('rejects a submit with no token when Google is reachable', () => {
    submit({
      recaptchaFetch: { body: { success: false, 'error-codes': ['invalid-input-response'] } },
    }).then((v) => {
      expectRejected(v);
      expect(scoredEvent(v)?.action).to.equal('login_password');
      expect(scoredEvent(v)?.reason).to.equal('no-token');
    });
  });

  it('checks the password as before for a valid token', () => {
    submit({ recaptchaFetch: { body: ok() }, token: 'tok' }).then((v) => {
      expectPasswordChecked(v);
      expect(scoredEvent(v)?.action).to.equal('login_password');
      expect(scoredEvent(v)?.verdict).to.equal('valid');
    });
  });

  it('fails open when Google is unreachable', () => {
    submit({ recaptchaFetch: { reject: true }, token: 'tok' }).then((v) => {
      expectPasswordChecked(v);
      expect(scoredEvent(v)?.verdict).to.equal('unavailable');
    });
  });

  it('records a low score as would_reject in observe mode', () => {
    submit({
      env: { ...RECAPTCHA_ENV, RECAPTCHA_MIN_SCORE: '0.5' },
      recaptchaFetch: { body: ok({ score: 0.2 }) },
      token: 'tok',
    }).then((v) => {
      expectPasswordChecked(v);
      expect(scoredEvent(v)?.action).to.equal('login_password');
      expect(scoredEvent(v)?.decision).to.equal('would_reject');
    });
  });

  it('rejects a low score when enforcement is on', () => {
    submit({
      env: { ...RECAPTCHA_ENV, RECAPTCHA_MIN_SCORE: '0.5', RECAPTCHA_ENFORCE_SCORE: 'true' },
      recaptchaFetch: { body: ok({ score: 0.2 }) },
      token: 'tok',
    }).then((v) => {
      expectRejected(v);
      expect(scoredEvent(v)?.decision).to.equal('reject');
    });
  });

  it('is inert when unconfigured', () => {
    submit({ env: {} }).then((v) => {
      expectPasswordChecked(v);
      expect(scoredEvent(v), 'unconfigured records no score').to.be.undefined;
    });
  });

  it('rejects a token minted for signup as an action mismatch', () => {
    submit({ recaptchaFetch: { body: ok({ action: 'signup' }) }, token: 'tok' }).then((v) => {
      expectRejected(v);
      expect(scoredEvent(v)?.reason).to.equal('action-mismatch');
    });
  });
});
