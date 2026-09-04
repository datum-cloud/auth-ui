// cypress/component/resources/authorize/expired-request-handback.cy.ts
//
// An authenticated user handed back to an EXPIRED auth request must not be told their session
// expired. Observed live: passkey sign-in succeeded, the hour-old auth request returned NOT_FOUND,
// and the screen claimed the session had expired. The session was seconds old.
import { callService } from '../../../support/node/call-service';

const LOGIN = 'signed-in@acme.test';
const USER = { id: 'u-si', loginName: LOGIN, displayName: 'Signed In' };
// Deliberately NOT seeded into `authRequests` — the fake throws NOT_FOUND for an unknown id,
// which is exactly what Zitadel does once a request has expired.
const EXPIRED = 'http://localhost/id/authorize?requestId=oidc_V2_expired-request';

describe('/authorize — expired auth request with a live session', () => {
  it('routes an authenticated user to /signed-in instead of the expired-session error', () => {
    callService({
      fn: 'resolveAuthorize',
      seed: { users: [USER] },
      liveSessions: [{ id: 'sess-live', token: 'tok-live', user: USER }],
      request: {
        url: EXPIRED,
        sessions: [{ id: 'sess-live', token: 'tok-live', loginName: LOGIN }],
      },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(v.response?.status, 'redirect, not an error page').to.equal(302);
      expect(v.response?.location ?? '').to.contain('/signed-in');
    });
  });

  // The other half: with NO session there is nothing to route to, and the expired-request error
  // is the correct and only honest answer. Asserted so the fix cannot widen into "swallow every
  // expired request".
  it('still surfaces the error when the browser holds no session', () => {
    callService({
      fn: 'resolveAuthorize',
      seed: { users: [USER] },
      request: { url: EXPIRED },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      const loc = v.response?.location ?? '';
      expect(loc, 'must not claim the user is signed in').to.not.contain('/signed-in');
      expect(loc, 'surfaces the error instead').to.contain('error');
    });
  });
});
