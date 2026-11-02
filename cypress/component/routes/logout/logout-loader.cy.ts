// cypress/component/routes/logout/logout-loader.cy.ts
//
// CY-TASK: logout route — the end_session (logout_token) handshake.
//
// GET /id/logout?logout_token=… used to sign the user out of every session without reading the
// token, so any third-party page could force that navigation (the cookie is SameSite=Lax) and
// sign the victim out everywhere. The GET now never touches sessions: it renders the confirm
// page, and the sign-out-of-all runs only from the CSRF-protected POST with scope=all.
import { callService } from '../../../support/node/call-service';

const BASE = 'http://localhost/id/logout';
const SESSION = { id: 's1', token: 't1', loginName: 'bob@acme.test' };
const LIVE = [{ id: 's1', token: 't1', user: { id: 'u9', loginName: 'bob@acme.test' } }];

describe('logout loader — logout_token GET', () => {
  it('a forged logout_token renders the confirm page and leaves the sessions cookie alone', () => {
    callService({
      fn: 'logoutLoader',
      provider: 'singleton',
      liveSessions: LIVE,
      request: {
        url: `${BASE}?logout_token=garbage&post_logout_redirect_uri=http%3A%2F%2Flocalhost%2Fdone`,
        sessions: [SESSION],
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response?.status, 'no redirect').to.not.equal(302);
      expect(v.response?.dataStatus ?? 200).to.equal(200);
      const body = v.response?.dataBody as { endSessionAll?: boolean; loginName?: string };
      expect(body.endSessionAll, 'renders the sign-out-everywhere confirm').to.equal(true);
      expect(body.loginName).to.equal('bob@acme.test');
      const cookies = [...(v.response?.dataSetCookies ?? []), v.response?.setCookie ?? ''];
      expect(
        cookies.some((c) => c.startsWith('sessions=')),
        'the sessions cookie is never rewritten by the GET'
      ).to.equal(false);
      expect(
        v.audit.some((e) => e.event === 'logout' && e.outcome === 'failure'),
        'the untrusted token is audited'
      ).to.equal(true);
    });
  });

  it('without a logout_token the GET is the plain confirm page', () => {
    callService({
      fn: 'logoutLoader',
      request: { url: BASE },
    }).then((v) => {
      const body = v.response?.dataBody as { endSessionAll?: boolean };
      expect(body.endSessionAll).to.equal(false);
    });
  });
});

describe('logout action — scope=all (the confirmed end_session)', () => {
  it('signs out of every session and falls back to /logout/success', () => {
    callService({
      fn: 'logoutAction',
      provider: 'singleton',
      liveSessions: [
        ...LIVE,
        { id: 's2', token: 't2', user: { id: 'u8', loginName: 'amy@acme.test' } },
      ],
      request: {
        url: `${BASE}?index`,
        csrf: true,
        sessions: [SESSION, { id: 's2', token: 't2', loginName: 'amy@acme.test' }],
        form: { scope: 'all' },
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/logout/success');
      expect(v.response?.cookieEntries, 'every account is gone').to.deep.equal([]);
    });
  });

  it('without scope=all the POST still signs out only the active account', () => {
    callService({
      fn: 'logoutAction',
      provider: 'singleton',
      liveSessions: [
        ...LIVE,
        { id: 's2', token: 't2', user: { id: 'u8', loginName: 'amy@acme.test' } },
      ],
      request: {
        url: `${BASE}?index`,
        csrf: true,
        sessions: [{ id: 's2', token: 't2', loginName: 'amy@acme.test' }, SESSION],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect((v.response?.cookieEntries ?? []).length, 'one account survives').to.equal(1);
    });
  });
});
