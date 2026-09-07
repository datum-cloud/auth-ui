// cypress/component/routes/signup/method-recaptcha-gate.cy.ts
import { callService } from '../../../support/node/call-service';

const URL = 'http://localhost/id/signup/method';

const IDENTITY = {
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

// Mirrors recaptcha-gate.cy.ts's RECAPTCHA_ENV: RECAPTCHA_SECRET_KEY requires PUBLIC_ORIGIN
// (env.server.ts's boot guard), and PUBLIC_ORIGIN's hostname ('localhost') must match the
// `hostname: 'localhost'` the siteverify fixtures below carry.
const RECAPTCHA_ENV = {
  RECAPTCHA_SITE_KEY: 'test-site-key',
  RECAPTCHA_SECRET_KEY: 'test-secret-key',
  PUBLIC_ORIGIN: 'http://localhost:3000',
  AUTH_EMAIL_DELIVERY_ENABLED: 'true',
};

const ok = (over: Record<string, unknown> = {}) => ({
  success: true,
  score: 0.9,
  action: 'signup',
  hostname: 'localhost',
  challenge_ts: new Date().toISOString(),
  ...over,
});

type ScoredEvent = { action?: string; verdict?: string; reason?: string; score?: number | null };

describe('signup/method reCAPTCHA gate', () => {
  it('rejects a passkey submit with no token, and makes zero Zitadel register calls', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: RECAPTCHA_ENV,
      // Google IS reachable, but the token is empty — the scripted-POST case this gate exists
      // for (a script that GETs the loader for its CSRF token, then POSTs straight here).
      recaptchaFetch: { body: { success: false, 'error-codes': ['invalid-input-response'] } },
      recordCalls: ['register'],
      request: {
        url: URL,
        form: { intent: 'passkey', ...IDENTITY },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_INPUT');
      expect(v.calls?.register ?? [], 'no Zitadel register call on a scripted POST').to.have.length(
        0
      );

      const scored = v.audit?.find((a) => a.event === 'signup_recaptcha_scored') as
        ScoredEvent | undefined;
      expect(scored, 'the gate scores and logs every attempt').to.exist;
      expect(
        scored?.action,
        'this route requests the shared signup action, not a third name'
      ).to.equal('signup');
      expect(scored?.verdict).to.equal('invalid');
      expect(scored?.reason).to.equal('no-token');
    });
  });

  it('allows when Google is unreachable, audited as a failure', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: RECAPTCHA_ENV,
      recaptchaFetch: { reject: true },
      request: {
        url: URL,
        form: { intent: 'passkey', ...IDENTITY, recaptchaToken: 'tok' },
        csrf: true,
      },
    }).then((v) => {
      // Fails open: registration proceeds exactly as it would with no reCAPTCHA configured at
      // all — same generic check-your-email terminal, no 400.
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);
      expect(body?.email).to.equal(IDENTITY.loginName);

      // 'unavailable' is Google failing us, not the caller failing the check — it must still be
      // recorded as a failure outcome so an operator can see the outage, not silently dropped.
      const scored = v.audit?.find(
        (a) => a.event === 'signup_recaptcha_scored' && a.outcome === 'failure'
      ) as ScoredEvent | undefined;
      expect(scored, 'a Google outage is logged as a failure, not swallowed').to.exist;
      expect(scored?.verdict).to.equal('unavailable');
      expect(scored?.reason).to.equal('transport');
    });
  });

  it('accepts a genuine token and completes registration', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: RECAPTCHA_ENV,
      recaptchaFetch: { body: ok() },
      request: {
        url: URL,
        form: { intent: 'passkey', ...IDENTITY, recaptchaToken: 'minted-for-signup' },
        csrf: true,
      },
    }).then((v) => {
      const scored = v.audit?.find((a) => a.event === 'signup_recaptcha_scored') as
        ScoredEvent | undefined;
      expect(scored, 'the gate scores the accept path too').to.exist;
      expect(scored?.action).to.equal('signup');
      expect(scored?.verdict).to.equal('valid');

      // Gate passed, and registration itself completed — the ACCEPT path, not just a 400 avoided.
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);
      expect(body?.email).to.equal(IDENTITY.loginName);
    });
  });

  it('is inert when unconfigured — behaves exactly as before this task', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: URL,
        form: { intent: 'passkey', ...IDENTITY },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);
      expect(body?.email).to.equal(IDENTITY.loginName);

      // Unconfigured deployments stay entirely dark, including the audit trail — mirrors
      // recaptcha-gate.cy.ts's identifier-route assertion.
      const scored = v.audit?.find((a) => a.event === 'signup_recaptcha_scored') as
        ScoredEvent | undefined;
      expect(scored, 'unconfigured emits no audit event at all').to.be.undefined;
    });
  });
});
