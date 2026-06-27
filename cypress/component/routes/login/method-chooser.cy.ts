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

  it('unknown user → USER_NOT_FOUND as a 200 inline error (F1)', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/login',
        form: { intent: 'email-link', loginName: 'nobody@acme.test' },
        csrf: true,
      },
    }).then((v) => {
      const status = v.response?.dataStatus ?? 200;
      expect(status).to.equal(200);
      expect(v.response?.dataBody).to.have.property('error', 'USER_NOT_FOUND');
    });
  });
});

// ── (B) /login/method loader ───────────────────────────────────────────────────

describe('/login/method loader', () => {
  it('mfa2-user@acme.test → methods contains password and otp_email', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: { url: 'http://localhost/id/login/method?loginName=mfa2-user%40acme.test' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      const methods = (v.response?.dataBody as { methods?: string[] })?.methods ?? [];
      expect(methods).to.include('password');
      expect(methods).to.include('otp_email');
    });
  });

  it('email-otp-user@acme.test → methods contains password and otp_email (length 2)', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: { url: 'http://localhost/id/login/method?loginName=email-otp-user%40acme.test' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      const methods = (v.response?.dataBody as { methods?: string[] })?.methods ?? [];
      expect(methods).to.include('password');
      expect(methods).to.include('otp_email');
      expect(methods).to.have.length(2);
    });
  });

  it('returns branding for the org (method chooser is branded)', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: { url: 'http://localhost/id/login/method?loginName=mfa2-user%40acme.test' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataBody).to.have.property('branding');
    });
  });

  it('unknown user → redirect to /login', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login/method?loginName=nobody%40acme.test' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login');
    });
  });

  it('missing loginName → redirect to /login', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login/method' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login');
    });
  });

  it('unknown user WITH requestId → redirect preserves requestId + organization', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login/method?loginName=nobody%40acme.test&requestId=rq1&organization=acme',
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login?requestId=rq1&organization=acme');
    });
  });

  it('missing loginName WITH requestId → redirect preserves requestId', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login/method?requestId=rq1' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login?requestId=rq1');
    });
  });

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
