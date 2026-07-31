// cypress/component/routes/login/passkey-hint-write.cy.ts
//
// The hint mirrors serializeLastUsedLogin at every login-success write site. These two are
// node-bound action specs: signed sessions cookie + CSRF round-trip (see password-reauth.cy.ts).
import { callService } from '../../../support/node/call-service';
import { CYPRESS_CREDENTIAL } from '@/components/webauthn-button/webauthn-button';

const ALICE = 'alice@acme.test'; // u1, password 'hunter2' in the fake singleton
const PK_USER = 'passkey-user@acme.test'; // u5, authMethods ['password','passkey']

describe('passkey-hint written on login success', () => {
  it('password action: the success redirect carries passkey-hint=<loginName>', () => {
    callService({
      fn: 'loginPasswordAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/login/password',
        sessions: [{ id: 's1', token: 't1', loginName: ALICE }],
        form: { loginName: ALICE, password: 'hunter2' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.passkeyHint).to.equal(ALICE);
    });
  });

  it('passkey verify action: the success redirect carries passkey-hint=<loginName> (rolling refresh)', () => {
    callService({
      fn: 'loginPasskeyAction',
      provider: 'singleton',
      liveSessions: [{ id: 's5', token: 't5', user: { id: 'u5', loginName: PK_USER } }],
      request: {
        url: 'http://localhost/id/login/passkey',
        sessions: [{ id: 's5', token: 't5', loginName: PK_USER }],
        form: {
          loginName: PK_USER,
          credential: JSON.stringify(CYPRESS_CREDENTIAL),
        },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.passkeyHint).to.equal(PK_USER);
      // Sanity: the existing last-used write is untouched.
      expect(v.response?.lastUsedLogin).to.equal('passkey');
    });
  });

  it('password action failure writes NO hint', () => {
    callService({
      fn: 'loginPasswordAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/login/password',
        sessions: [{ id: 's1', token: 't1', loginName: ALICE }],
        form: { loginName: ALICE, password: 'wrong-password' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.passkeyHint ?? null).to.equal(null);
    });
  });
});
