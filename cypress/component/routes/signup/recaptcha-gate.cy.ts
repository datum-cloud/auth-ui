// cypress/component/routes/signup/recaptcha-gate.cy.ts
import { callService } from '../../../support/node/call-service';

const URL = 'http://localhost/id/signup';

// Mirrors cypress/component/server/recaptcha.cy.ts's RECAPTCHA_ENV: RECAPTCHA_SECRET_KEY requires
// PUBLIC_ORIGIN (env.server.ts's boot guard), and PUBLIC_ORIGIN's hostname ('localhost') must
// match the `hostname: 'localhost'` the siteverify fixtures below carry.
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

describe('signup reCAPTCHA gate', () => {
  it('rejects an identifier submit with no token', () => {
    callService({
      fn: 'signupIndexAction',
      env: RECAPTCHA_ENV,
      // Google IS reachable, but the token is empty — the scripted-POST case the whole feature
      // exists for. Mirrors recaptcha.cy.ts's "rejects a missing token when Google is reachable".
      recaptchaFetch: { body: { success: false, 'error-codes': ['invalid-input-response'] } },
      recordCalls: ['register'],
      request: {
        url: URL,
        form: { email: 'bot@acme.test' },
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
      expect(scored?.action, 'identifier step requests the plain signup action').to.equal('signup');
      expect(scored?.verdict).to.equal('invalid');
      expect(scored?.reason).to.equal('no-token');
    });
  });

  it('rejects a signup token replayed against intent=code', () => {
    callService({
      fn: 'signupIndexAction',
      env: RECAPTCHA_ENV,
      // Google validates the token — it really was minted by grecaptcha.execute() — but for the
      // 'signup' action, on the IDENTIFIER step. Replayed here on the CODE step, which requires
      // 'signup_code'. The gate must reject this even though the token is genuine.
      recaptchaFetch: { body: ok({ action: 'signup' }) },
      recordCalls: ['findUser'],
      request: {
        url: URL,
        form: {
          intent: 'code',
          email: 'replay@acme.test',
          code: 'WHATEVER1',
          recaptchaToken: 'minted-for-signup',
        },
        csrf: true,
      },
    }).then((v) => {
      // Proves the action name is chosen PER INTENT, not fixed: the audit record carries the same
      // `recaptchaAction` value the gate passed to verifyRecaptcha as `expectedAction`, and Google's
      // own action-mismatch check is what turned this genuine-but-wrong-step token into 'invalid'.
      const scored = v.audit?.find((a) => a.event === 'signup_recaptcha_scored') as
        ScoredEvent | undefined;
      expect(scored, 'the gate scores and logs every attempt').to.exist;
      expect(scored?.action, 'code step requests signup_code, not the identifier action').to.equal(
        'signup_code'
      );
      expect(scored?.verdict).to.equal('invalid');
      expect(scored?.reason).to.equal('action-mismatch');

      // INVALID_INPUT (the gate's rejection), not INVALID_CODE (the code branch's own rejection
      // shape) — proves the request never reached the code-entry logic at all.
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_INPUT');
      expect(v.calls?.findUser ?? [], 'gate runs before any Zitadel call (G7)').to.have.length(0);
    });
  });

  it('accepts a genuine signup_code token and completes the code step', () => {
    callService({
      fn: 'signupIndexAction',
      env: RECAPTCHA_ENV,
      seed: { users: [{ id: 'u-1', loginName: 'coded@acme.test', displayName: 'C' }] },
      // Google validates the token for the CODE-STEP action this time — the genuine case Task
      // 4's suite never exercised.
      recaptchaFetch: { body: ok({ action: 'signup_code' }) },
      request: {
        url: URL,
        form: {
          intent: 'code',
          email: 'coded@acme.test',
          // The fake provider gives every seeded user a deterministic pending code of
          // email-<userId> (see signup-code.cy.ts's "accepts the valid code" case).
          code: 'email-u-1',
          recaptchaToken: 'minted-for-signup-code',
        },
        csrf: true,
      },
    }).then((v) => {
      const scored = v.audit?.find((a) => a.event === 'signup_recaptcha_scored') as
        ScoredEvent | undefined;
      expect(scored, 'the gate scores the code step').to.exist;
      expect(scored?.action, 'code step requests signup_code').to.equal('signup_code');
      expect(scored?.verdict).to.equal('valid');

      // Gate passed, and the code branch itself accepted the correct code and redirected into
      // passkey setup — the ACCEPT path, not just a 400 avoided.
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.include('/setup/passkey');
    });
  });

  it('allows when Google is unreachable', () => {
    callService({
      fn: 'signupIndexAction',
      env: RECAPTCHA_ENV,
      recaptchaFetch: { reject: true },
      request: {
        url: URL,
        form: { email: 'sunny@acme.test', recaptchaToken: 'tok' },
        csrf: true,
      },
    }).then((v) => {
      // Fails open: the request proceeds exactly like the unconfigured/no-token-needed path —
      // same generic check-your-email terminal, no 400.
      expect(v.response?.isResponse, 'not blocked by a Google outage').to.equal(false);
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);
      expect(body?.email).to.equal('sunny@acme.test');

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

  it('allows a low score in observe mode', () => {
    callService({
      fn: 'signupIndexAction',
      env: RECAPTCHA_ENV,
      recaptchaFetch: { body: ok({ score: 0.1 }) },
      request: {
        url: URL,
        form: { email: 'lowscore@acme.test', recaptchaToken: 'tok' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);

      // A valid-but-low score is recorded, not enforced — this feature scores, it does not
      // threshold. The score must be visible to an operator even though the request proceeded.
      const scored = v.audit?.find(
        (a) => a.event === 'signup_recaptcha_scored' && a.outcome === 'success'
      ) as ScoredEvent | undefined;
      expect(scored, 'a valid low score is still logged').to.exist;
      expect(scored?.score).to.equal(0.1);
    });
  });

  it('intent=idp reaches startIdpIntent and redirects — exempt from the gate even when it is configured', () => {
    callService({
      fn: 'signupIndexAction',
      env: RECAPTCHA_ENV,
      // If intent=idp ever fell back through the gate, THIS is what would reject it — same
      // stub as "rejects an identifier submit with no token" above. A regression here shows up
      // as a 400, not as this test accidentally passing on a token nobody sent.
      recaptchaFetch: { body: { success: false, 'error-codes': ['invalid-input-response'] } },
      recordCalls: ['startIdpIntent'],
      request: {
        url: URL,
        // No recaptchaToken — exactly what IdpButtonList actually sends (see
        // idp-button-list.tsx: intent + idpId + optional deviceTrackingToken, nothing else).
        form: { intent: 'idp', idpId: 'idp-g' },
        csrf: true,
      },
    }).then((v) => {
      expect(
        v.calls?.startIdpIntent ?? [],
        'the exemption is real, not an accidental pass — startIdpIntent was actually called'
      ).to.have.length(1);
      expect(v.calls?.startIdpIntent?.[0]?.[0]).to.equal('idp-g');

      expect(v.response?.isResponse, 'a redirect, not a 400 JSON error').to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.include('idp=idp-g');

      // Never scored at all — the exemption skips the gate outright, it does not merely pass it.
      const scored = v.audit?.find((a) => a.event === 'signup_recaptcha_scored');
      expect(scored, 'intent=idp never reaches verifyRecaptcha').to.be.undefined;
    });
  });

  it('is inert when unconfigured', () => {
    callService({
      fn: 'signupIndexAction',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: URL,
        form: { email: 'noconfig@acme.test' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);
      expect(body?.email).to.equal('noconfig@acme.test');

      const scored = v.audit?.find((a) => a.event === 'signup_recaptcha_scored') as
        ScoredEvent | undefined;
      expect(scored, 'unconfigured emits no audit event at all').to.be.undefined;
    });
  });
});
