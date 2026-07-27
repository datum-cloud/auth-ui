// cypress/component/routes/reauth-action.cy.ts
//
// /reauth action, intent=idp-reauth: never trust the client's idpId — it must resolve
// to an ACTIVE, non-LDAP provider actually LINKED to the current session's own user
// before starting the round-trip. Previously only re-checked active+non-LDAP (any org
// IdP would pass), relying entirely on the callback's identity-mismatch rejection.
import { callService } from '../../support/node/call-service';

const USER = { id: 'u1', loginName: 'mia@acme.test' };

describe('/reauth action — intent=idp-reauth', () => {
  it('a linked IdP starts the OAuth round-trip (redirects to the authUrl)', () => {
    callService({
      fn: 'reauthAction',
      seed: {
        users: [USER],
        idps: [{ id: 'idp-google', name: 'Google', type: 'GOOGLE' }],
        idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
      },
      liveSessions: [{ id: 'sess-1', token: 'sess-tok-1', user: USER }],
      request: {
        url: 'http://localhost/id/reauth',
        sessions: [{ id: 'sess-1', token: 'sess-tok-1', loginName: USER.loginName }],
        form: { intent: 'idp-reauth', idpId: 'idp-google', returnTo: '/passkeys' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.contain('idp-google');
    });
  });

  it('rejects an idpId that is active in the org but NOT linked to this user', () => {
    // Never trust the client's idpId — a crafted POST for an active-but-unlinked
    // provider must not start a round-trip, even though it would still be caught at
    // the callback stage by the identity-mismatch check.
    callService({
      fn: 'reauthAction',
      seed: {
        users: [USER],
        idps: [
          { id: 'idp-google', name: 'Google', type: 'GOOGLE' },
          { id: 'idp-github', name: 'GitHub', type: 'GITHUB' },
        ],
        idpLinks: { u1: [{ idpId: 'idp-google', idpUserId: 'g-1' }] },
      },
      liveSessions: [{ id: 'sess-1', token: 'sess-tok-1', user: USER }],
      request: {
        url: 'http://localhost/id/reauth',
        sessions: [{ id: 'sess-1', token: 'sess-tok-1', loginName: USER.loginName }],
        form: { intent: 'idp-reauth', idpId: 'idp-github', returnTo: '/passkeys' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
    });
  });

  it('no session redirects to /login', () => {
    callService({
      fn: 'reauthAction',
      seed: { users: [USER] },
      request: {
        url: 'http://localhost/id/reauth',
        form: { intent: 'idp-reauth', idpId: 'idp-google', returnTo: '/passkeys' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login');
    });
  });
});
