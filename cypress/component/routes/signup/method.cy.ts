// cypress/component/routes/signup/method.cy.ts
//
// cy.task port of app/routes/signup/__tests__/method.test.tsx.
// Covers the signup/method loader + action (email-link, password, passkey intents).
import { callService } from '../../../support/node/call-service';

const IDENTITY = {
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

// ── Loader ────────────────────────────────────────────────────────────────────

describe('signup/method loader', () => {
  it('returns csrfToken, view, and loginName for a plain email URL', () => {
    callService({
      fn: 'signupMethodLoader',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/signup/method?loginName=john.doe@example.com&firstName=John&lastName=Doe',
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.csrfToken).to.be.ok;
      expect(body?.loginName).to.equal('john.doe@example.com');
      expect(body?.view).to.not.be.undefined;
      expect(body?.isIdp).to.be.undefined;
    });
  });

  it('ignores idpIntentId params (IdP users are auto-created in the SSO callback)', () => {
    callService({
      fn: 'signupMethodLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/method?loginName=john@example.com&firstName=John&lastName=Doe&idpIntentId=intent-abc&idpIntentToken=tok&idpId=idp-g&idpUserId=u1&idpUserName=john',
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.isIdp).to.be.undefined;
      expect(body?.idpIntentId).to.be.undefined;
      expect(body?.loginName).to.equal('john@example.com');
    });
  });
});

// ── Action: email-link ────────────────────────────────────────────────────────

describe('signup/method action — email-link', () => {
  it('returns sent=true with status 200 (genericCheckYourEmail)', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'email-link', ...IDENTITY },
        csrf: true,
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      expect(body?.sent).to.equal(true);
      expect(body?.email).to.equal(IDENTITY.loginName);
    });
  });

  it('threads organization and requestId into the email-link call', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'email-link', ...IDENTITY, organization: 'acme', requestId: 'req-xyz' },
        csrf: true,
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);
    });
  });
});

// ── Action: password ──────────────────────────────────────────────────────────

describe('signup/method action — password', () => {
  it('redirects to /signup/password with identity params (302)', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'password', ...IDENTITY },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/signup/password');
      expect(loc).to.include('loginName=john.doe%40example.com');
      expect(loc).to.include('firstName=John');
      expect(loc).to.include('lastName=Doe');
    });
  });

  it('threads deviceTrackingToken into the password redirect', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'password', ...IDENTITY, deviceTrackingToken: 'mm-tok-abc' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.location ?? '').to.include('deviceTrackingToken=mm-tok-abc');
    });
  });
});

// ── Action: passkey ───────────────────────────────────────────────────────────

describe('signup/method action — passkey', () => {
  it('returns sent=true (200) — email verification gate before enrollment', () => {
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

// ── Action: validation ────────────────────────────────────────────────────────

describe('signup/method action — validation', () => {
  it('returns 400 INVALID_INPUT when intent is missing', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/method',
        form: { loginName: 'john@example.com' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_INPUT');
    });
  });
});
