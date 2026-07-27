// cypress/component/resources/passkeys/passkeys.service.cy.ts
//
// NO-MOUNT: /id/passkeys management service — sudo gate, last-method guard,
// idempotent removal, sign-out-others. Direct-import style with a local fake:
// the service takes an already-read SessionEntry[], so no cookie/env stubs needed.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import type { SessionEntry } from '@/modules/auth/session/session';
import type { AuthMethod, ProviderErrorCode } from '@/modules/auth/types';
import { ProviderError } from '@/modules/auth/types';
import {
  loadPasskeysView,
  removeUserPasskey,
  signOutOtherSessions,
} from '@/resources/passkeys/passkeys.service';
import { SUDO_TTL_MS } from '@/resources/shared/sudo';

const USER = { id: 'u1', loginName: 'mia@acme.test' };

async function seeded(opts?: {
  authMethods?: AuthMethod[];
  passkeys?: Array<{ id: string; state: 'active' | 'inactive'; name: string }>;
  provider?: FakeAuthProvider;
}) {
  const fake =
    opts?.provider ??
    new FakeAuthProvider({
      users: [USER],
      passwords: { u1: 'Password1!' },
      authMethods: { u1: opts?.authMethods ?? ['password', 'passkey'] },
      passkeys: { u1: opts?.passkeys ?? [{ id: 'pk-1', state: 'active', name: 'Seeded laptop' }] },
      // Real factor stamps: the sudo check compares against real Date.now()-based nowMs.
      realFactorTimestamps: true,
    });
  const s = await fake.createSession({ password: 'Password1!' }, { userId: 'u1' });
  const entry: SessionEntry = {
    id: s.id,
    token: s.token,
    loginName: USER.loginName,
    creationTs: s.changedAt,
    expirationTs: s.expiresAt,
    changeTs: s.changedAt,
  };
  return { fake, sessions: [entry] };
}

describe('passkeys.service — /id/passkeys management', () => {
  it('fresh sudo ⇒ view with rows + methodCount; validated returnTo is threaded', async () => {
    const { fake, sessions } = await seeded();
    const v = await loadPasskeysView(fake, sessions, { returnTo: '/passkeys', nowMs: Date.now() });
    expect(v.kind).to.equal('view');
    if (v.kind === 'view') {
      expect(v.passkeys).to.deep.equal([{ id: 'pk-1', state: 'active', name: 'Seeded laptop' }]);
      expect(v.methodCount).to.equal(2);
      expect(v.loginName).to.equal(USER.loginName);
      expect(v.returnTo).to.equal('/passkeys');
    }
  });

  it('stale sudo ⇒ loader redirects to /reauth AND removeUserPasskey refuses server-side', async () => {
    const { fake, sessions } = await seeded();
    const staleNow = Date.now() + SUDO_TTL_MS + 1;
    const v = await loadPasskeysView(fake, sessions, { returnTo: null, nowMs: staleNow });
    expect(v).to.deep.equal({ kind: 'redirect', target: '/reauth?returnTo=%2Fpasskeys' });
    // Server-side enforcement is independent of the loader:
    const r = await removeUserPasskey(fake, sessions, { passkeyId: 'pk-1', nowMs: staleNow });
    expect(r).to.deep.equal({ ok: false, error: 'SUDO_REQUIRED' });
  });

  it('last-method guard: passkey-only user with one passkey ⇒ LAST_METHOD; password backup ⇒ ok', async () => {
    const solo = await seeded({ authMethods: ['passkey'] });
    const refused = await removeUserPasskey(solo.fake, solo.sessions, {
      passkeyId: 'pk-1',
      nowMs: Date.now(),
    });
    expect(refused).to.deep.equal({ ok: false, error: 'LAST_METHOD' });

    const backed = await seeded({ authMethods: ['password', 'passkey'] });
    const removed = await removeUserPasskey(backed.fake, backed.sessions, {
      passkeyId: 'pk-1',
      nowMs: Date.now(),
    });
    expect(removed).to.deep.equal({ ok: true, removedName: 'Seeded laptop' });
    expect(await backed.fake.listPasskeys('u1')).to.deep.equal([]);
  });

  it('removal race: already-gone passkey and a NOT_FOUND adapter error are both idempotent success', async () => {
    // Fake path: the id simply is not in the list (silent no-op).
    const { fake, sessions } = await seeded({ passkeys: [] });
    const gone = await removeUserPasskey(fake, sessions, { passkeyId: 'pk-x', nowMs: Date.now() });
    expect(gone.ok).to.equal(true);

    // Real-adapter path: RemovePasskey rejects with NOT_FOUND — treated identically.
    class NotFoundOnRemove extends FakeAuthProvider {
      override async removePasskey(_userId: string, _passkeyId: string): Promise<void> {
        throw new ProviderError('NOT_FOUND' as ProviderErrorCode, 'passkey not found');
      }
    }
    const scripted = new NotFoundOnRemove({
      users: [USER],
      passwords: { u1: 'Password1!' },
      authMethods: { u1: ['password', 'passkey'] },
      passkeys: { u1: [{ id: 'pk-1', state: 'active', name: 'Seeded laptop' }] },
      realFactorTimestamps: true,
    });
    const withScripted = await seeded({ provider: scripted });
    const raced = await removeUserPasskey(scripted, withScripted.sessions, {
      passkeyId: 'pk-1',
      nowMs: Date.now(),
    });
    expect(raced.ok).to.equal(true);
  });

  it('signOutOtherSessions deletes every non-active entry provider-side and keeps only the active one', async () => {
    const { fake, sessions } = await seeded();
    const other = await fake.createSession({ password: 'Password1!' }, { userId: 'u1' });
    const otherEntry: SessionEntry = {
      id: other.id,
      token: other.token,
      loginName: USER.loginName,
      creationTs: '2026-01-01T00:00:00.000Z', // older ⇒ sessions[0] stays the active entry
      expirationTs: other.expiresAt,
      changeTs: '2026-01-01T00:00:00.000Z',
    };
    const all = [...sessions, otherEntry];

    const result = await signOutOtherSessions(fake, all, { nowMs: Date.now() });
    expect(result.ok).to.equal(true);
    if (result.ok) {
      expect(result.sessions).to.have.length(1);
      expect(result.sessions[0].id).to.equal(sessions[0].id);
    }
    // The other session is gone provider-side; the active one survives.
    expect(await fake.getSession(other.id, other.token)).to.equal(null);
    expect(await fake.getSession(sessions[0].id, sessions[0].token)).to.not.equal(null);
  });

  it('cross-device sessions (not in the cookie) are deleted; the active one survives', async () => {
    const { fake, sessions } = await seeded();
    // A session on "another device": provider-side only, NOT in the cookie list.
    const remote = await fake.createSession({ password: 'Password1!' }, { userId: 'u1' });

    const result = await signOutOtherSessions(fake, sessions, { nowMs: Date.now() });
    expect(result.ok).to.equal(true);
    expect(await fake.getSession(remote.id, remote.token)).to.equal(null);
    expect(await fake.getSession(sessions[0].id, sessions[0].token)).to.not.equal(null);
  });

  it('stale sudo refuses signout-others server-side', async () => {
    const { fake, sessions } = await seeded();
    const result = await signOutOtherSessions(fake, sessions, {
      nowMs: Date.now() + SUDO_TTL_MS + 1,
    });
    expect(result).to.deep.equal({ ok: false, error: 'SUDO_REQUIRED' });
  });

  it('no live active session ⇒ SESSION_EXPIRED', async () => {
    const { fake } = await seeded();
    const result = await signOutOtherSessions(fake, [], { nowMs: Date.now() });
    expect(result).to.deep.equal({ ok: false, error: 'SESSION_EXPIRED' });
  });

  it('a failed user-session search degrades to cookie-scoped behavior', async () => {
    class SearchFails extends FakeAuthProvider {
      override async listUserSessions(_userId: string): Promise<never> {
        throw new ProviderError('UNAVAILABLE' as ProviderErrorCode, 'search down');
      }
    }
    const scripted = new SearchFails({
      users: [USER],
      passwords: { u1: 'Password1!' },
      authMethods: { u1: ['password', 'passkey'] },
      passkeys: { u1: [{ id: 'pk-1', state: 'active', name: 'Seeded laptop' }] },
      realFactorTimestamps: true,
    });
    const { sessions } = await seeded({ provider: scripted });
    const other = await scripted.createSession({ password: 'Password1!' }, { userId: 'u1' });
    const otherEntry: SessionEntry = {
      id: other.id,
      token: other.token,
      loginName: USER.loginName,
      creationTs: '2026-01-01T00:00:00.000Z',
      expirationTs: other.expiresAt,
      changeTs: '2026-01-01T00:00:00.000Z',
    };

    const result = await signOutOtherSessions(scripted, [...sessions, otherEntry], {
      nowMs: Date.now(),
    });
    expect(result.ok).to.equal(true);
    // The cookie-known other entry is still deleted (token path), search failure notwithstanding.
    expect(await scripted.getSession(other.id, other.token)).to.equal(null);
  });

  it('a failing deleteUserSession is swallowed per-session — the sweep completes remaining deletions before returning', async () => {
    class DeleteFailsFor extends FakeAuthProvider {
      failId: string | null = null;
      override async deleteUserSession(sessionId: string): Promise<void> {
        if (sessionId === this.failId) {
          throw new ProviderError('UNAVAILABLE' as ProviderErrorCode, 'device unreachable');
        }
        // Real macrotask delay: completion-before-return then depends on the sweep
        // AWAITING every per-session outcome. Without the inner per-session catch, the
        // first rejection short-circuits Promise.all and the service returns via the
        // OUTER catch before this delayed delete lands — the r2 assertion below fails.
        await new Promise((resolve) => setTimeout(resolve, 20));
        await super.deleteUserSession(sessionId);
      }
    }
    const scripted = new DeleteFailsFor({
      users: [USER],
      passwords: { u1: 'Password1!' },
      authMethods: { u1: ['password', 'passkey'] },
      passkeys: { u1: [{ id: 'pk-1', state: 'active', name: 'Seeded laptop' }] },
      realFactorTimestamps: true,
    });
    const { sessions } = await seeded({ provider: scripted });
    const r1 = await scripted.createSession({ password: 'Password1!' }, { userId: 'u1' });
    const r2 = await scripted.createSession({ password: 'Password1!' }, { userId: 'u1' });
    scripted.failId = r1.id;

    const result = await signOutOtherSessions(scripted, sessions, { nowMs: Date.now() });
    expect(result.ok).to.equal(true);
    // Asserted IMMEDIATELY after resolution (microtasks only, no timer yields): r2 must
    // ALREADY be gone — with the per-session catch removed the service returns early
    // and r2's delayed delete has not landed yet, failing this line.
    expect(await scripted.getSession(r2.id, r2.token)).to.equal(null);
    // The unreachable session survives (failure swallowed); the active one survives.
    expect(await scripted.getSession(r1.id, r1.token)).to.not.equal(null);
    expect(await scripted.getSession(sessions[0].id, sessions[0].token)).to.not.equal(null);
  });
});
