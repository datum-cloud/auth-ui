// cypress/component/resources/webauthn/challenge-token-rotation.cy.ts
//
// REGRESSION: arming a challenge must persist the ROTATED session token.
//
// updateSession rotates the token; arming is an update. Reading only the challenge options left
// the cookie holding a token the provider had replaced, so every assertion after was rejected and
// retrying could not help. The suite could not see this — FakeAuthProvider returned the same token
// forever — hence `rotateSessionTokens`.
import { callService } from '../../../support/node/call-service';

const LOGIN = 'passkey-user@acme.test';
const USER = { id: 'u-pk', loginName: LOGIN, displayName: 'Passkey User' };
const SEED = {
  users: [USER],
  authMethods: { 'u-pk': ['passkey'] },
  rotateSessionTokens: true,
};

/** The session entries the response asks the browser to store. */
function cookieTokens(setCookies: string[] | undefined): string[] {
  const raw = (setCookies ?? []).find((c) => c.startsWith('sessions='));
  return raw ? [raw] : [];
}

describe('webauthn challenge — persists the rotated session token', () => {
  it('the loader emits a sessions cookie after arming (not the pre-challenge one)', () => {
    callService({
      fn: 'loginPasskeyLoader',
      seed: SEED,
      liveSessions: [{ id: 'sess-1', token: 'tok-1', user: USER }],
      request: {
        url: `http://localhost/id/login/passkey?loginName=${encodeURIComponent(LOGIN)}`,
        sessions: [{ id: 'sess-1', token: 'tok-1', loginName: LOGIN }],
      },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      const cookies = [...(v.response?.setCookies ?? []), ...(v.response?.dataSetCookies ?? [])];
      // BEFORE THE FIX this array was empty: the challenge armed, the token rotated provider-side,
      // and nothing was written back — so the browser silently kept tok-1.
      expect(
        cookieTokens(cookies),
        'arming a challenge must rewrite the sessions cookie with the rotated token'
      ).to.have.length(1);
    });
  });
});
