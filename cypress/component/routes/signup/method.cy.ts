// cypress/component/routes/signup/method.cy.ts
//
// cy.task port of app/routes/signup/__tests__/method.test.tsx.
// Covers the signup/method action, which is passkey-only: one register path, one response shape.
//
// It previously fanned out over three intents. 'email-link' and 'passkey' ran BYTE-IDENTICAL
// bodies (two buttons, one behavior) and 'password' handed off to /signup/password; the screen
// now offers passkey alone, and signupMethodSchema rejects the other two at the parse boundary.
import { callService } from '../../../support/node/call-service';

const IDENTITY = {
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

// ── Action: passkey (the only intent) ─────────────────────────────────────────

describe('signup/method action — passkey', () => {
  it('returns sent=true with status 200 (genericCheckYourEmail)', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'passkey', ...IDENTITY },
        csrf: true,
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      expect(body?.sent).to.equal(true);
      expect(body?.email).to.equal(IDENTITY.loginName);
    });
  });
});

// ── Action: retired intents are rejected server-side ──────────────────────────
//
// The buttons are gone from the screen, but hiding a control is display-only. These assert the
// ENFORCEMENT half: a hand-crafted POST — or a form cached in a tab opened before the change —
// cannot reach a path signup no longer offers. Both fail closed at signupMethodSchema, so
// neither registers an account nor hands off to /signup/password.
describe('signup/method action — retired intents fail closed', () => {
  for (const intent of ['email-link', 'password'] as const) {
    it(`rejects intent=${intent} with 400 INVALID_INPUT and no redirect`, () => {
      callService({
        fn: 'signupMethodAction',
        provider: 'singleton',
        env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
        request: {
          url: 'http://localhost/id/signup/method',
          form: { intent, ...IDENTITY },
          csrf: true,
        },
      }).then((v) => {
        expect(v.response?.isResponse, `${intent}: must not redirect`).to.equal(false);
        expect(v.response?.dataStatus, intent).to.equal(400);
        expect(v.response?.dataBody, intent).to.have.property('error', 'INVALID_INPUT');
      });
    });
  }
});
