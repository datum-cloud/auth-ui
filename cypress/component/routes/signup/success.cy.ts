// cypress/component/routes/signup/success.cy.ts
//
// The signup terminal retires the signup session, plus the guard that stops it being a
// cross-site logout.
//
// That session is authenticated by otpEmail alone and enrolling a passkey adds no factor, so it
// arrives permanently incomplete. Left in the cookie, signing in mints a SECOND session and
// prompt=select_account then offers two entries for one account — picking the stale one dead-ends.
import { callService } from '../../../support/node/call-service';

const LOGIN = 'newuser@acme.test';
const USER = { id: 'u-new', loginName: LOGIN, displayName: 'New User' };
const COOKIE = [{ id: 'sess-signup', token: 'tok-signup', loginName: LOGIN }];
const URL = `http://localhost/id/signup/success?loginName=${encodeURIComponent(LOGIN)}`;

/**
 * Did the loader tell the browser to rewrite the sessions cookie?
 *
 * This loader returns react-router `data(...)`, NOT a Response, so the harness reports its
 * Set-Cookie headers under `dataSetCookies` — `setCookies` is only populated for a real Response.
 * Both are checked so the helper stays correct if the loader ever becomes a redirect.
 */
function droppedSession(res: { setCookies?: string[]; dataSetCookies?: string[] }): boolean {
  return [...(res.setCookies ?? []), ...(res.dataSetCookies ?? [])].some((c) =>
    c.startsWith('sessions=')
  );
}

describe('signup/success — retires the factor-incomplete signup session', () => {
  it('drops a session whose only factor is otpEmail (the shape signup actually mints)', () => {
    callService({
      fn: 'signupSuccessLoader',
      seed: { users: [USER] },
      // otpEmail ONLY: alive, bound to the user, but not primary-authenticated.
      liveSessions: [
        { id: 'sess-signup', token: 'tok-signup', user: USER, factorKinds: ['otpEmail'] },
      ],
      request: { url: URL, sessions: COOKIE },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(droppedSession(v.response ?? {}), 'must rewrite the sessions cookie').to.be.true;
    });
  });

  it('drops a session the provider no longer knows about', () => {
    callService({
      fn: 'signupSuccessLoader',
      seed: { users: [USER] },
      // No liveSessions seeded → getSession resolves null. A dead entry cannot authenticate
      // anyone and pollutes the picker exactly the same way.
      request: { url: URL, sessions: COOKIE },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(droppedSession(v.response ?? {})).to.be.true;
    });
  });
});

// THE GUARD. This is a GET, so a cross-site page can point a victim's browser at
// /signup/success?loginName=<them>. Evicting on the URL param alone would make that a
// one-request logout, so the loader reads the LIVE session and only retires one with no primary
// factor — i.e. one that could not sign anyone in anyway.
// The passkey HINT must go too, and for a reason independent of the session.
// signup/complete writes it so a returning user gets the passkey shortcut on /login. Left set
// after signup it points /login at passkey paths this browser cannot yet complete: the shortcut
// links to /login/passkey, which needs a session entry to arm a challenge and bounces without one
// (a button that does nothing), and conditional-UI autofill arms a DISCOVERABLE request whose
// arming mints a session — so the next pass through discover returns 409 already_signed_in.
describe('signup/success — clears the passkey hint', () => {
  it('expires the passkey-hint cookie so /login starts at the identifier step', () => {
    callService({
      fn: 'signupSuccessLoader',
      seed: { users: [USER] },
      liveSessions: [
        { id: 'sess-signup', token: 'tok-signup', user: USER, factorKinds: ['otpEmail'] },
      ],
      request: { url: URL, sessions: COOKIE },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      const cookies = [...(v.response?.setCookies ?? []), ...(v.response?.dataSetCookies ?? [])];
      expect(
        cookies.some((c) => c.startsWith('passkey-hint=')),
        'must rewrite passkey-hint'
      ).to.be.true;
    });
  });

  // Unconditional: the hint is cleared even when the session is left alone, because the two
  // problems are separate — an authenticated session does not make the hint safe to keep here.
  it('clears the hint even when the session is authenticated and kept', () => {
    callService({
      fn: 'signupSuccessLoader',
      seed: { users: [USER] },
      liveSessions: [{ id: 'sess-signup', token: 'tok-signup', user: USER }],
      request: { url: URL, sessions: COOKIE },
    }).then((v) => {
      const cookies = [...(v.response?.setCookies ?? []), ...(v.response?.dataSetCookies ?? [])];
      expect(cookies.some((c) => c.startsWith('passkey-hint='))).to.be.true;
      expect(droppedSession(v.response ?? {}), 'session still untouched').to.be.false;
    });
  });
});

describe('signup/success — never evicts an authenticated session', () => {
  it('leaves a primary-authenticated session alone', () => {
    callService({
      fn: 'signupSuccessLoader',
      seed: { users: [USER] },
      // Default factorKinds is ['password'] — a genuinely signed-in session.
      liveSessions: [{ id: 'sess-signup', token: 'tok-signup', user: USER }],
      request: { url: URL, sessions: COOKIE },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(
        droppedSession(v.response ?? {}),
        'a forged request must not be able to log the victim out'
      ).to.be.false;
    });
  });

  it('does nothing without a loginName to act on', () => {
    callService({
      fn: 'signupSuccessLoader',
      seed: { users: [USER] },
      liveSessions: [
        { id: 'sess-signup', token: 'tok-signup', user: USER, factorKinds: ['otpEmail'] },
      ],
      request: { url: 'http://localhost/id/signup/success', sessions: COOKIE },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(droppedSession(v.response ?? {})).to.be.false;
    });
  });
});
