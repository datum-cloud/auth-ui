// cypress/component/routes/login/conditional-passkey-loader.cy.ts
//
// The /login loader's usernameless arming + suppression list, at the HTTP boundary.
// ?organization=org1 is threaded so the loader RENDERS (same note as
// last-used-login-loader.cy.ts). Singleton seed: u5 passkey-user@acme.test has
// authMethods ['password','passkey']; u1 alice@acme.test is password-only.
import { callService } from '../../../support/node/call-service';

const PK_USER = 'passkey-user@acme.test';
const URL_BASE = 'http://localhost/id/login?organization=org1';
type LoaderBody = {
  conditionalPasskey?: { loginName?: string; publicKeyCredentialRequestOptions?: unknown } | null;
};

describe('/login loader — conditional passkey arming', () => {
  it('no hint → arms nothing', () => {
    callService({ fn: 'loginLoader', provider: 'singleton', request: { url: URL_BASE } }).then(
      (v) => {
        expect((v.response?.dataBody as LoaderBody).conditionalPasskey).to.equal(null);
      }
    );
  });

  it('hinted passkey user → arms: challenge returned, ceremony session persisted', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: URL_BASE, passkeyHint: PK_USER },
    }).then((v) => {
      const body = v.response?.dataBody as LoaderBody;
      expect(body.conditionalPasskey?.loginName).to.equal(PK_USER);
      expect(body.conditionalPasskey?.publicKeyCredentialRequestOptions).to.exist;
      expect(
        (v.response?.dataSetCookies ?? []).some((c: string) => c.startsWith('sessions='))
      ).to.equal(true);
    });
  });

  it('?add=1 (add-another-account arrival) suppresses arming', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: `${URL_BASE}&add=1`, passkeyHint: PK_USER },
    }).then((v) => {
      expect((v.response?.dataBody as LoaderBody).conditionalPasskey).to.equal(null);
      expect(
        (v.response?.dataSetCookies ?? []).some((c: string) => c.startsWith('sessions='))
      ).to.equal(false);
    });
  });

  it('hinted user already has a live session → suppresses arming', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: {
        url: URL_BASE,
        passkeyHint: PK_USER,
        sessions: [{ id: 's5', token: 't5', loginName: PK_USER }],
      },
    }).then((v) => {
      expect((v.response?.dataBody as LoaderBody).conditionalPasskey).to.equal(null);
    });
  });

  it('a STALE (expired) session entry for the hinted user does NOT suppress arming', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: {
        url: URL_BASE,
        passkeyHint: PK_USER,
        // expirationTs in the known past → listSessions drops it → the fast path arms.
        sessions: [{ id: 's5', token: 't5', loginName: PK_USER, expirationTs: '1000' }],
      },
    }).then((v) => {
      const body = v.response?.dataBody as LoaderBody;
      expect(body.conditionalPasskey?.loginName).to.equal(PK_USER);
    });
  });

  it('a stale cross-organization session entry for the hinted user does not break the mint', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: {
        url: URL_BASE,
        passkeyHint: PK_USER,
        // Same loginName as the entry about to be minted, but tagged with a DIFFERENT
        // organization than the request's ?organization=org1, and stale (expirationTs in the
        // past) so hasLiveSession doesn't suppress arming. Regression guard for the loader's
        // loginName-only supersede (index.tsx: `priorCleared`): a same-loginName duplicate
        // under ANY organization must be cleared before minting, or it can shadow the fresh
        // ceremony entry in byLoginName's mostRecent tie-break and the challenge mint silently
        // returns null (same class of bug the same-org stale case above guards).
        sessions: [
          { id: 's7', token: 't7', loginName: PK_USER, organization: 'org2', expirationTs: '1000' },
        ],
      },
    }).then((v) => {
      const body = v.response?.dataBody as LoaderBody;
      expect(body.conditionalPasskey?.loginName).to.equal(PK_USER);
      expect(body.conditionalPasskey?.publicKeyCredentialRequestOptions).to.exist;
    });
  });

  it('hint names an unknown user → arms nothing AND clears the hint', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: URL_BASE, passkeyHint: 'ghost@acme.test' },
    }).then((v) => {
      expect((v.response?.dataBody as LoaderBody).conditionalPasskey).to.equal(null);
      const cleared = (v.response?.dataSetCookies ?? []).find((c: string) =>
        c.startsWith('passkey-hint=')
      );
      expect(cleared ?? '').to.include('Max-Age=0');
    });
  });

  it('hinted user without a passkey → suppresses arming, keeps the hint', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: URL_BASE, passkeyHint: 'alice@acme.test' },
    }).then((v) => {
      expect((v.response?.dataBody as LoaderBody).conditionalPasskey).to.equal(null);
      expect(
        (v.response?.dataSetCookies ?? []).some((c: string) => c.startsWith('passkey-hint='))
      ).to.equal(false);
    });
  });
});
