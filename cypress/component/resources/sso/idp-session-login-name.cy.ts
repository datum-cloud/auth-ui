// cypress/component/resources/sso/idp-session-login-name.cy.ts
//
// Regression guard for issue #1485 — "Signed-in via GitHub. Can't add passkey."
//
// signInWithIdpIntent writes the `sessions` cookie, and that cookie's loginName is NOT a display
// hint: byLoginName() keys on it, findUser() is called with it, and /accounts compares it against
// the provider session's user to decide "Session active" vs "Needs re-authentication". It must
// therefore hold the ZITADEL loginName, never the IdP-side handle.
//
// Every other SSO fixture in this suite uses an email-shaped idpUserName ('you@gmail.com',
// 'mia@gmail.com', 'linked@idp.test'), where handle and loginName coincide — which is precisely
// why the regression shipped unnoticed. GitHub is the provider that breaks the tie: its
// IDPInformation.userName is the account handle, and its primary email is hidden behind the
// access token. These fixtures keep the two DELIBERATELY divergent.
import { callService } from '../../../support/node/call-service';

/** What Zitadel knows the user as (username + org domain). */
const ZITADEL_LOGIN_NAME = 'octocat@datum.net';
/** What GitHub vouches for in IDPInformation.userName — the bare handle. */
const GITHUB_HANDLE = 'octocat';

const URL = 'http://localhost/id/sso/github/callback';
const signInOpts = {
  idpIntentId: 'i1',
  idpIntentToken: 't1',
  userId: 'u1',
  fallbackLoginName: GITHUB_HANDLE,
  requestId: 'oidc_x',
};

type CookieEntry = { id: string; loginName: string; organization?: string };

describe('signInWithIdpIntent — session cookie identity (issue #1485)', () => {
  it('persists the Zitadel loginName, not the IdP-vouched handle', () => {
    callService({
      fn: 'signInWithIdpIntent',
      seed: { users: [{ id: 'u1', loginName: ZITADEL_LOGIN_NAME }] },
      signInOpts,
      request: { url: URL },
      inspect: { cookieSessions: true },
    }).then((v) => {
      const entries = v.inspect?.cookieSessions as CookieEntry[] | null;
      expect(entries, 'sessions cookie round-tripped').to.have.length(1);
      // The assertion that fails before the fix: the handle was written verbatim, so every later
      // findUser(loginName) missed and /setup/passkey bounced to /login.
      expect(entries?.[0].loginName).to.equal(ZITADEL_LOGIN_NAME);
      expect(entries?.[0].loginName).to.not.equal(GITHUB_HANDLE);
    });
  });

  it('still matches a re-auth intent recorded under the old IdP handle', () => {
    // reauthRedirect records the intent from the COOKIE entry's loginName, so a session minted
    // before this fix recorded 'octocat'. Now that sign-in resolves to 'octocat@datum.net', a
    // naive compare would false-mismatch EVERY legacy IdP re-auth into the account picker for the
    // cookie's whole 12h life. Same person, two spellings — the ceremony must continue.
    callService({
      fn: 'signInWithIdpIntent',
      seed: { users: [{ id: 'u1', loginName: ZITADEL_LOGIN_NAME }] },
      signInOpts,
      request: { url: URL, reauthIntent: GITHUB_HANDLE },
      inspect: { cookieSessions: true },
    }).then((v) => {
      const r = v.outcome as { target?: string; reauthClearCookie?: string };
      expect(r.target, 'ceremony continues').to.include('/authorize');
      expect(r.target).to.not.include('reauthMismatch');
      expect(r.reauthClearCookie ?? '').to.include('reauth-intent=');
      // The cookie is still rewritten to the canonical name — the tolerance is in the compare,
      // not a licence to keep persisting the handle.
      const entries = v.inspect?.cookieSessions as CookieEntry[] | null;
      expect(entries?.[0].loginName).to.equal(ZITADEL_LOGIN_NAME);
    });
  });

  it('still bounces a genuine identity mismatch to the picker', () => {
    // The widened compare must not blunt the guard: a DIFFERENT account signing in against a
    // pending re-auth intent still has to land on /accounts with both accounts kept.
    callService({
      fn: 'signInWithIdpIntent',
      seed: { users: [{ id: 'u1', loginName: ZITADEL_LOGIN_NAME }] },
      signInOpts,
      request: { url: URL, reauthIntent: 'someone-else@datum.net' },
    }).then((v) => {
      const r = v.outcome as { target?: string };
      expect(r.target).to.include('/accounts');
      expect(r.target).to.include('reauthMismatch=1');
      expect(r.target).to.not.include('/authorize');
    });
  });

  it('falls back to the IdP-vouched name when the session resolves no user', () => {
    // A session that carries no bound user still needs a non-empty loginName — the fallback
    // stays the second choice, not a dead branch.
    callService({
      fn: 'signInWithIdpIntent',
      seed: {},
      signInOpts,
      request: { url: URL },
      inspect: { cookieSessions: true },
    }).then((v) => {
      const entries = v.inspect?.cookieSessions as CookieEntry[] | null;
      expect(entries, 'sessions cookie round-tripped').to.have.length(1);
      expect(entries?.[0].loginName).to.equal(GITHUB_HANDLE);
    });
  });
});
