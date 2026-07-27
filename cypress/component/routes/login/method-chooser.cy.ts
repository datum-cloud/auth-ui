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

  it("resolves idps to only this user's linked (active, non-LDAP) providers", () => {
    // Google is active AND linked to u1; GitHub is active but NOT linked — must not surface.
    callService({
      fn: 'loginMethodLoader',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['password', 'idp'] },
        idps: [
          { id: 'idp-google', name: 'Google', type: 'GOOGLE' },
          { id: 'idp-github', name: 'GitHub', type: 'GITHUB' },
        ],
        idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
      },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: { url: 'http://localhost/id/login/method?loginName=mia%40acme.test' },
    }).then((v) => {
      const body = v.response?.dataBody as { methods: string[]; idps: Array<{ id: string }> };
      expect(body.methods).to.include('idp');
      expect(body.idps).to.deep.equal([{ id: 'idp-google', name: 'Google', type: 'GOOGLE' }]);
    });
  });
});

describe('/login/method action — intent=idp', () => {
  it('a linked IdP starts the OAuth round-trip (redirects to the authUrl)', () => {
    callService({
      fn: 'loginMethodAction',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['password', 'idp'] },
        idps: [{ id: 'idp-google', name: 'Google', type: 'GOOGLE' }],
        idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
      },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        form: { intent: 'idp', idpId: 'idp-google' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.contain('idp-google');
    });
  });

  it('rejects an idpId that is active in the org but NOT linked to this user', () => {
    // Never trust the client's idpId — a crafted POST for an active-but-unlinked provider
    // must not start a round-trip, mirroring reauth.tsx's own defense-in-depth check.
    callService({
      fn: 'loginMethodAction',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        authMethods: { u1: ['password', 'idp'] },
        idps: [
          { id: 'idp-google', name: 'Google', type: 'GOOGLE' },
          { id: 'idp-github', name: 'GitHub', type: 'GITHUB' },
        ],
        idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
      },
      request: {
        url: 'http://localhost/id/login/method?loginName=mia%40acme.test',
        form: { intent: 'idp', idpId: 'idp-github' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
    });
  });
});
