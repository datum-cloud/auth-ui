// cypress/component/resources/login/dead-session-recovery.cy.ts
//
// fix/dead-session-recovery — root-caused from real staging logs:
//
// 1) A user holding an active session for identity A opens the auth app and registers a NEW
//    account B. signup.service.ts's persistSession APPENDS session B's entry via addSession;
//    identity A's stale entry is left in the `sessions` cookie.
// 2) RP-initiated logout terminates the Zitadel session server-side, but the browser lands on
//    /id/logout/success, which does NOT clear the `sessions` cookie (only /id/logout does) — so
//    auth-ui keeps a {id, token} for a session Zitadel has already terminated.
// 3) login.service.ts's byLoginName lookup can return that stale entry (see
//    modules/auth/session/session.cy.ts Fix B spec for the shadowing mechanics).
// 4) verifyLoginPassword calls provider.updateSession(entry.id, entry.token, ...) with the dead
//    id → Zitadel throws FailedPrecondition/9 "Session already terminated", which
//    mappers.ts#normalizeError classifies as ALREADY_DONE (NOT FAILED_PRECONDITION — see
//    mappers.cy.ts). Before this fix, verifyLoginPassword re-threw anything that wasn't
//    INVALID_CREDENTIALS, and login/password.tsx has no try/catch → root ErrorBoundary → 500.
//
// Fix: any NON-transient ProviderError from updateSession means the stored session is dead, not
// a live outage — prune the stale entry (removeSession) and return a recoverable SESSION_EXPIRED
// instead of throwing. Transient codes (UNAVAILABLE/DEADLINE_EXCEEDED/RATE_LIMITED) are real
// outages and must still throw (mirrors the account-switch precedent: session.service.ts's
// SWITCH_TRANSIENT_CODES allowlist + reauthRedirect).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import type { SessionEntry } from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import { verifyLoginPassword } from '@/resources/login';

const LOGIN_NAME = 'bob@acme.test';

const staleEntry: SessionEntry = {
  id: 'sess-stale',
  token: 'tok-stale',
  loginName: LOGIN_NAME,
  creationTs: '1',
  expirationTs: '9999999999999',
  changeTs: '1',
};

function makeProvider(): FakeAuthProvider {
  const provider = new FakeAuthProvider({
    users: [{ id: 'u1', loginName: LOGIN_NAME }],
    passwords: { u1: 'hunter2' },
    authMethods: { u1: ['password'] },
  });
  // Seed the live session backing `staleEntry` so the REAL (unscripted) updateSession — exercised
  // by the INVALID_CREDENTIALS spec below — finds a live session rather than NOT_FOUND.
  provider.seedLiveSession({
    id: staleEntry.id,
    token: staleEntry.token,
    user: { id: 'u1', loginName: LOGIN_NAME },
  });
  return provider;
}

/** Script updateSession to throw a given ProviderError on every call (Fake-only monkey-patch —
 * same seam the node harness uses for scripted overrides the fake's built-in scripting doesn't
 * cover, e.g. cypress/support/node/harness.ts's `provider.getSession = (async () => {...})`). */
function scriptUpdateSessionThrow(provider: FakeAuthProvider, error: ProviderError): void {
  provider.updateSession = (async () => {
    throw error;
  }) as FakeAuthProvider['updateSession'];
}

describe('verifyLoginPassword — dead-session recovery (stale entry survives RP-initiated logout)', () => {
  it('a non-transient ProviderError (ALREADY_DONE — the real "Session already terminated" classification) prunes the stale entry and returns SESSION_EXPIRED instead of throwing', async () => {
    const fake = makeProvider();
    scriptUpdateSessionThrow(
      fake,
      new ProviderError(
        'ALREADY_DONE',
        '[failed_precondition] Session already terminated (COMMAND-Hewfq)'
      )
    );

    const result = await verifyLoginPassword(fake, [staleEntry], {
      loginName: LOGIN_NAME,
      password: 'hunter2',
    });

    expect(result.ok).to.equal(false);
    if (result.ok) return;
    expect(result.error).to.equal('SESSION_EXPIRED');
    // The stale entry must be pruned from the returned sessions (so the route can emit a
    // cookie that no longer carries it) — not silently left in place.
    expect('sessions' in result ? result.sessions : undefined).to.deep.equal([]);
  });

  it('a transient ProviderError (UNAVAILABLE) still throws — a real outage must never be silently swallowed as a dead session', async () => {
    const fake = makeProvider();
    scriptUpdateSessionThrow(fake, new ProviderError('UNAVAILABLE', 'zitadel unreachable'));

    let caught: unknown;
    try {
      await verifyLoginPassword(fake, [staleEntry], { loginName: LOGIN_NAME, password: 'hunter2' });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(ProviderError);
    expect((caught as ProviderError).code).to.equal('UNAVAILABLE');
  });

  it('INVALID_CREDENTIALS keeps its existing dedicated branch (untouched by the recovery path)', async () => {
    const fake = makeProvider();
    // wrong password against the REAL fake updateSession (not scripted) — exercises the
    // pre-existing branch to prove the new recovery logic doesn't shadow it.
    const result = await verifyLoginPassword(fake, [staleEntry], {
      loginName: LOGIN_NAME,
      password: 'WRONG',
    });
    expect(result.ok).to.equal(false);
    if (result.ok) return;
    expect(result.error).to.equal('INVALID_CREDENTIALS');
  });
});
