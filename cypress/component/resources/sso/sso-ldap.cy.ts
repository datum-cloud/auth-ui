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
});
