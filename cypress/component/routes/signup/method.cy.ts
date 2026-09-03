// cypress/component/routes/signup/method.cy.ts
//
// cy.task port of app/routes/signup/__tests__/method.test.tsx.
// Covers the signup/method action fan-out: email-link and password intents.
// (passkey intent shares the same genericCheckYourEmail shape as email-link;
// loader param-threading and input validation are covered structurally elsewhere.)
import { callService } from '../../../support/node/call-service';

const IDENTITY = {
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

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
});

// ── Action: passkey ≡ email-link (Phase B collapse) ───────────────────────────

describe('signup/method action — passkey collapses into email-link (Phase B)', () => {
  it('passkey intent returns the same generic response as email-link', () => {
    callService({
      fn: 'signupMethodAction',
      seed: {},
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'passkey', loginName: 'fresh@b.test', firstName: 'A', lastName: 'B' },
        csrf: true,
      },
    }).then((pk) => {
      callService({
        fn: 'signupMethodAction',
        seed: {},
        env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
        request: {
          url: 'http://localhost/id/signup/method',
          form: { intent: 'email-link', loginName: 'other@b.test', firstName: 'A', lastName: 'B' },
          csrf: true,
        },
      }).then((link) => {
        // Same shape entirely: data status, body modulo the submitted address, cookies.
        expect(pk.response?.isResponse, 'passkey returns data, not a redirect').to.equal(
          link.response?.isResponse
        );
        expect(pk.response?.dataStatus ?? 200).to.equal(link.response?.dataStatus ?? 200);
        const pkBody = JSON.stringify(pk.response?.dataBody ?? {}).replace('fresh@b.test', '<a>');
        const linkBody = JSON.stringify(link.response?.dataBody ?? {}).replace(
          'other@b.test',
          '<a>'
        );
        expect(pkBody).to.equal(linkBody);
        expect(pk.response?.setCookies ?? []).to.deep.equal(link.response?.setCookies ?? []);
      });
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
});
