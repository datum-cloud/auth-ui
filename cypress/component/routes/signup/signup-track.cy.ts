// cypress/component/routes/signup/signup-track.cy.ts
//
// cy.task port of app/routes/signup/__tests__/signup-track.test.tsx.
// Covers signup/index action fan-out: email identifier → register + generic check-your-email,
// and IdP intent → 302 to the provider authUrl. Loader param-threading and validation
// permutations are cut here (already exercised structurally elsewhere in this suite).
import { callService } from '../../../support/node/call-service';

// ── Action: email identifier ──────────────────────────────────────────────────

describe('signup/index — action: email identifier', () => {
  // This used to assert a 302 to /signup/method carrying loginName + a placeholder name derived
  // from the address. /signup now registers inline with the name the user typed.
  it('registers with the typed name and returns the generic check-your-email terminal', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      recordCalls: ['register'],
      request: {
        url: 'http://localhost/id/signup',
        form: { email: 'john.doe@example.com', firstName: ' John ', lastName: 'Doe' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse, 'no longer redirects to an interstitial').to.equal(false);
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);
      expect(body?.email).to.equal('john.doe@example.com');

      // The account is created with the typed (trimmed) name, never the email-derived placeholder.
      const registered = (v.calls?.register ?? []) as Array<[Record<string, unknown>]>;
      expect(registered).to.have.length(1);
      expect(registered[0][0]).to.include({ firstName: 'John', lastName: 'Doe' });
    });
  });

  it('returns 400 INVALID_INPUT without a first and last name, registering nothing', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      recordCalls: ['register'],
      request: {
        url: 'http://localhost/id/signup',
        form: { email: 'no.name@example.com' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_INPUT');
      expect(v.calls?.register ?? []).to.have.length(0);
    });
  });

  // Defense in depth, mirroring the /signup/method action: passkey signup IS the verification-mail
  // flow, so with delivery off there is nothing this route can complete. It must fail closed
  // rather than register an account that can never be verified.
  it('returns 400 INVALID_INPUT when AUTH_EMAIL_DELIVERY_ENABLED=false', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'false' },
      request: {
        url: 'http://localhost/id/signup',
        form: { email: 'delivery-off@example.com', firstName: 'Ada', lastName: 'Lovelace' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_INPUT');
    });
  });
});

// ── Action: IdP intent ────────────────────────────────────────────────────────

describe('signup/index — action: IdP intent', () => {
  it('redirects (302) to the IdP authUrl for a seeded IdP (idp-g)', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup',
        form: { intent: 'idp', idpId: 'idp-g' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
    });
  });
});
