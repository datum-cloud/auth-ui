// cypress/component/server/recaptcha.cy.ts
import { callService } from '../../support/node/call-service';

const RECAPTCHA_ENV = {
  RECAPTCHA_SITE_KEY: 'test-site-key',
  RECAPTCHA_SECRET_KEY: 'test-secret-key',
  PUBLIC_ORIGIN: 'http://localhost:3000',
};

// Mirrors the (unexported) SITEVERIFY_URL constant in recaptcha.server.ts.
const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

const ok = (over: Record<string, unknown> = {}) => ({
  success: true,
  score: 0.9,
  action: 'signup',
  hostname: 'localhost',
  challenge_ts: new Date().toISOString(),
  ...over,
});

describe('verifyRecaptcha', () => {
  it('accepts a valid, correctly-actioned, fresh token', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: 'tok', expectedAction: 'signup' },
      recaptchaFetch: { body: ok() },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('valid');
      expect(v.outcome.score).to.equal(0.9);
    });
  });

  it('POSTs the token and secret to the real siteverify endpoint', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: 'tok', expectedAction: 'signup' },
      recaptchaFetch: { body: ok() },
    }).then((v) => {
      const request = v.outcome.request as {
        url: string;
        method?: string;
        hasSecret: boolean;
        hasResponse: boolean;
      };
      expect(request.url).to.equal(SITEVERIFY_URL);
      expect(request.method).to.equal('POST');
      expect(request.hasSecret).to.equal(true);
      expect(request.hasResponse).to.equal(true);
    });
  });

  it('rejects a token minted for a different action', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: 'tok', expectedAction: 'signup' },
      recaptchaFetch: { body: ok({ action: 'signup_code' }) },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('invalid');
      expect(v.outcome.reason).to.equal('action-mismatch');
    });
  });

  it('rejects a token Google itself marks unsuccessful', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: 'tok', expectedAction: 'signup' },
      recaptchaFetch: { body: ok({ success: false }) },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('invalid');
      expect(v.outcome.reason).to.equal('rejected');
    });
  });

  it('rejects a token minted for a different hostname', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: 'tok', expectedAction: 'signup' },
      recaptchaFetch: { body: ok({ hostname: 'evil.com' }) },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('invalid');
      expect(v.outcome.reason).to.equal('hostname-mismatch');
    });
  });

  it('skips the hostname check — and passes — when PUBLIC_ORIGIN is unset', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: 'tok', expectedAction: 'signup' },
      recaptchaFetch: { body: ok({ hostname: 'evil.com' }) },
      recaptchaSkipPublicOrigin: true,
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('valid');
      expect(v.outcome.reason).to.equal('ok');
    });
  });

  it('rejects a stale token', () => {
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: 'tok', expectedAction: 'signup' },
      recaptchaFetch: { body: ok({ challenge_ts: old }) },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('invalid');
      expect(v.outcome.reason).to.equal('stale');
    });
  });

  it('reports unavailable — never throws — when Google fails', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: 'tok', expectedAction: 'signup' },
      recaptchaFetch: { reject: true },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('unavailable');
      expect(v.outcome.reason).to.equal('transport');
    });
  });

  it('rejects a missing token when Google is reachable', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: '', expectedAction: 'signup' },
      recaptchaFetch: { body: { success: false, 'error-codes': ['invalid-input-response'] } },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('invalid');
      expect(v.outcome.reason).to.equal('no-token');
    });
  });

  it('ALLOWS a missing token when Google is unreachable', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: RECAPTCHA_ENV,
      recaptchaInput: { token: '', expectedAction: 'signup' },
      recaptchaFetch: { reject: true },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('unavailable');
      expect(v.outcome.reason).to.equal('transport');
    });
  });

  // Not one of the brief's six tests, but recaptchaConfigured()'s fail-open contract
  // (an unconfigured deployment must behave exactly as it does today) is untested without it —
  // see the "Note not-configured returns valid" callout in the task-3 brief's Step 3.
  it('is a no-op (fail-open) when reCAPTCHA is not configured', () => {
    callService({
      fn: 'verifyRecaptcha',
      env: {},
      recaptchaInput: { token: '', expectedAction: 'signup' },
    }).then((v) => {
      expect(v.outcome.outcome).to.equal('valid');
      expect(v.outcome.score).to.equal(null);
      expect(v.outcome.reason).to.equal('not-configured');
    });
  });
});
