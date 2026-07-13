// cypress/component/routes/login/method-chooser.cy.ts
//
// cy.task port of app/routes/login/__tests__/method-chooser.test.tsx.
// (A) /login action intent=email-link → 302 to /login/verify/email.
// (B) /login/method loader → methods array, branding, redirect guards.
import { callService } from '../../../support/node/call-service';

// ── (A) intent=email-link ──────────────────────────────────────────────────────

describe('login action — intent=email-link', () => {
  it('known user → 302 to /login/verify/email with set-cookie', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login',
        form: { intent: 'email-link', loginName: 'email-otp-user@acme.test' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.match(/\/login\/verify\/email(\?|$)/);
      expect(loc).to.contain('loginName=email-otp-user%40acme.test');
      expect(v.response?.setCookie).to.be.a('string');
    });
  });
});

// ── (B) /login/method loader ───────────────────────────────────────────────────

describe('/login/method loader', () => {
  it('alice@acme.test (password-only) → redirects away (< 2 methods)', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: { url: 'http://localhost/id/login/method?loginName=alice%40acme.test' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.contain('/login/password');
    });
  });
});
