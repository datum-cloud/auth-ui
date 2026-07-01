// cypress/component/resources/sso/sso-fingerprint.cy.ts
//
// cy.task node-spec port of app/resources/sso/__tests__/fingerprint.service.test.ts.
// End-to-end thread: the fingerprintId minted/reused in processIdpCallback must (a) ride out on
// the finalizing Set-Cookie when the browser lacked it, and (b) be the SAME id handed to
// createSession's userAgent. Node-bound: mints via crypto, reads the raw fingerprintId Cookie
// header (forbidden in the browser), and inspects lastCreateSessionOpts.
import { callService, type Scenario } from '../../../support/node/call-service';

const REGISTER_INTENT_VERIFIED: Scenario['idpIntent'] = {
  userId: null,
  information: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'you@gmail.com' },
  draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CB = 'https://auth.localtest.me/sso/google/callback?id=intent-1&token=tok-1';

describe('fingerprintId end-to-end through the SSO auto-create createSession', () => {
  it('cookie ABSENT: mints + Set-Cookie, and the SAME id reaches createSession userAgent', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB },
      inspect: { lastCreateSessionFingerprintId: true },
    }).then((v) => {
      const minted = v.response?.fingerprintId;
      expect(minted, 'minted fingerprintId').to.match(UUID_RE);

      // OLD-app cookie attributes preserved.
      const fpCookie = (v.response?.setCookies ?? []).find((c) => c.startsWith('fingerprintId='));
      expect(fpCookie, 'fingerprintId Set-Cookie').to.not.equal(undefined);
      expect(fpCookie).to.include('Max-Age=31536000');
      expect(fpCookie).to.include('Path=/');
      expect(fpCookie).to.include('HttpOnly');

      // The created session's userAgent carries that EXACT id (no first-session gap).
      expect(v.inspect?.lastCreateSessionFingerprintId).to.equal(minted);

      // The session cookie is still set alongside it (multiple Set-Cookie headers).
      expect((v.response?.setCookies ?? []).some((c) => c.startsWith('sessions='))).to.equal(true);
    });
  });
});
