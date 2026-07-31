// cypress/component/routes/logout/success-clears-cookies.cy.ts
//
// Regression: the Zitadel app is registered with
// `post-logout-redirect-uris: https://auth.<env>.datum.net/id/logout/success`, so the OIDC
// end_session hop lands the browser on /logout/success DIRECTLY — /id/logout (the only route
// that ran completeOidcLogout) is never invoked. That left `sessions` and `passkey-hint`
// alive in the browser, and a live-looking session entry suppresses the /login passkey
// fast path (login/index.tsx `hasLiveSession`), so returning users got a bare email field
// instead of the passkey dialog.
//
// /logout/success is the RP's registered landing page: arriving there means logout already
// happened, so its loader must terminate any residual provider sessions and clear both cookies.
import { callService } from '../../../support/node/call-service';

const ALICE = 'alice@acme.test'; // u1 in the fake singleton

describe('logout/success loader clears local auth cookies', () => {
  it('clears sessions + passkey-hint when the OIDC hop lands here directly', () => {
    callService({
      fn: 'logoutSuccessLoader',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/logout/success',
        sessions: [{ id: 's1', token: 't1', loginName: ALICE }],
        passkeyHint: ALICE,
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const cookies = v.response?.dataSetCookies ?? [];

      const sessions = cookies.find((c) => c.startsWith('sessions='));
      expect(sessions, 'sessions Set-Cookie present').to.be.a('string');

      const hint = cookies.find((c) => c.startsWith('passkey-hint='));
      expect(hint, 'passkey-hint Set-Cookie present').to.be.a('string');
      // clearPasskeyHint() serializes an empty value with Max-Age=0
      expect(hint).to.match(/Max-Age=0/i);
    });
  });

  it('is idempotent — no cookies to clear still renders without error', () => {
    callService({
      fn: 'logoutSuccessLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/logout/success' },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response?.isResponse).to.equal(false);
    });
  });
});
