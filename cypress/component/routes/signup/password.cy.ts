// cypress/component/routes/signup/password.cy.ts
//
// cy.task port of app/routes/signup/__tests__/password.test.tsx.
// Covers the signup/password action: enumeration-safe error handling for existing
// accounts (security regression gate) and the real-provider happy path. Loader
// param-threading, schema-validation permutations, and complexity-policy fan-out are
// covered once each in password-loader-action.cy.ts / password.cy.ts siblings — not
// duplicated here.
import { callService } from '../../../support/node/call-service';

const VALID_IDENTITY = {
  loginName: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  password: 'sup3rsecret',
  confirm: 'sup3rsecret',
};

// ── Action: ALREADY_EXISTS enumeration safety (tamper-proof error model) ─────

describe('signup/password — action: ALREADY_EXISTS enumeration safety', () => {
  // Security regression gate (restored from password.test.tsx, adapted for cy.task).
  //
  // The route's actionError handler correctly maps ProviderError('ALREADY_EXISTS') → HTTP 409
  // + { error: 'ALREADY_EXISTS' } with no raw message (verified: app/utils/errors/auth-error.ts
  // resolveAuthError). However, that catch block is structurally unreachable via the real code
  // path: registerWithPassword → runEnumerationSafeRegister always catches ALREADY_EXISTS first
  // and returns { kind: 'sent' }, so the route emits 200 — not 409. This is intentional
  // (SEC: account existence must be indistinguishable from a fresh signup to prevent enumeration).
  //
  // Observable security property tested here:
  //   • Duplicate email → 200 { sent: true } (same as a fresh signup — no status divergence)
  //   • body.error absent (no ALREADY_EXISTS code in the client response)
  //   • Raw provider message 'already registered' never reaches the client body
  //
  // Harness seam: form.preRegisterEmail seeds the FakeAuthProvider with that address and
  // shadows provider.register() to throw ALREADY_EXISTS for it, then restores the prototype
  // method after the action runs (cypress/support/node/harness.ts signupPasswordAction case).
  it('returns 200 with sent:true and never leaks the raw ALREADY_EXISTS provider message', () => {
    callService({
      fn: 'signupPasswordAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/password',
        form: {
          preRegisterEmail: 'jane@example.com',
          loginName: 'jane@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
          password: 'sup3rsecret',
          confirm: 'sup3rsecret',
        },
        csrf: true,
      },
    }).then((v) => {
      // Enumeration-safe: service catches ALREADY_EXISTS → returns the same generic 200
      // 'check your email' response as a fresh signup. The 409 path in actionError is
      // intentionally unreachable through the normal registration flow.
      const status = v.response?.isResponse ? v.response.status : (v.response?.dataStatus ?? 200);
      expect(status, 'duplicate email must return 200 (enumeration-safe, not 409)').to.equal(200);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      // Tamper-proof error model: no error code or raw provider message in the response.
      expect(body?.error, 'ALREADY_EXISTS code must not appear in response body').to.be.undefined;
      expect(body?.sent, 'response must signal sent:true (generic check-your-email)').to.equal(
        true
      );
      const serialized = JSON.stringify(body ?? {});
      // Raw provider error message must never reach the client.
      expect(serialized, 'raw provider message must not leak').not.to.include('already registered');
      // Error code string must not appear anywhere in the serialized body.
      expect(serialized, 'ALREADY_EXISTS code string must not leak').not.to.include(
        'ALREADY_EXISTS'
      );
    });
  });
});

// ── Action: happy path (real provider) ───────────────────────────────────────

describe('signup/password — action: real provider happy path', () => {
  it('completes without throwing and returns a 2xx or 3xx response for valid inputs', () => {
    callService({
      fn: 'signupPasswordAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/signup/password',
        form: { ...VALID_IDENTITY, loginName: 'happypath@example.com' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.ok).to.equal(true);
      const status = v.response?.isResponse
        ? (v.response.status ?? 200)
        : (v.response?.dataStatus ?? 200);
      expect(status).to.be.within(200, 399);
    });
  });
});
