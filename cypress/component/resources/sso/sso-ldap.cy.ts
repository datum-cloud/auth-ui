// cypress/component/resources/sso/sso-ldap.cy.ts
//
// cy.task node-spec port of app/resources/sso/__tests__/ldap.service.test.ts.
// submitLdapCredentials calls the shared signInWithIdpIntent helper (reads/writes the signed
// `sessions` cookie) and relies on the richly-seeded singleton's LDAP fixtures (bob/pw → u13,
// unlinked/pw → ''), so it is node-bound. outcomeToResponse is exercised identically to the route.
import { callService } from '../../../support/node/call-service';

const URL = 'http://localhost/id/sso/ldap';

describe('/sso/ldap action (submitLdapCredentials)', () => {
  it('valid creds (bob/pw, idpId idp-ldap) → 302 to /signed-in with sessions cookie', () => {
    callService({
      fn: 'submitLdapCredentials',
      provider: 'singleton',
      request: { url: URL, form: { username: 'bob', password: 'pw', idpId: 'idp-ldap' } },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/signed-in');
      expect(v.response?.setCookie ?? '').to.include('sessions=');
    });
  });

  it('valid creds WITH requestId → 302 to /authorize?requestId=oidc_x&sessionId=<id>', () => {
    callService({
      fn: 'submitLdapCredentials',
      provider: 'singleton',
      request: {
        url: URL,
        form: { username: 'bob', password: 'pw', idpId: 'idp-ldap', requestId: 'oidc_x' },
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/authorize?requestId=oidc_x');
      expect(loc).to.match(/[?&]sessionId=sess-\d+/);
    });
  });

  it('bad creds → 401 with error INVALID_CREDENTIALS, not a redirect', () => {
    callService({
      fn: 'submitLdapCredentials',
      provider: 'singleton',
      request: { url: URL, form: { username: 'bob', password: 'wrong', idpId: 'idp-ldap' } },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(401);
      expect((v.response?.dataBody as { error?: string })?.error).to.equal('INVALID_CREDENTIALS');
    });
  });

  it('valid creds but UNLINKED LDAP user (empty userId) → 403 ACCOUNT_NOT_LINKED', () => {
    callService({
      fn: 'submitLdapCredentials',
      provider: 'singleton',
      request: { url: URL, form: { username: 'unlinked', password: 'pw', idpId: 'idp-ldap' } },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(403);
      expect((v.response?.dataBody as { error?: string })?.error).to.equal('ACCOUNT_NOT_LINKED');
    });
  });

  it('missing idpId → 400 with error invalid_input, not a redirect', () => {
    callService({
      fn: 'submitLdapCredentials',
      provider: 'singleton',
      request: { url: URL, form: { username: 'bob', password: 'pw' } },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(400);
      expect((v.response?.dataBody as { error?: string })?.error).to.equal('invalid_input');
    });
  });
});
