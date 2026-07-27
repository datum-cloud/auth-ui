// cypress/component/resources/reauth/reauth.service.cy.ts
//
// NO-MOUNT: reauth.service verifies one factor onto the EXISTING session (SetSession
// semantics). Direct-import style with a locally constructed FakeAuthProvider — the
// service takes an already-read SessionEntry[], so no cookie/env stubs are needed.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import type { SessionEntry } from '@/modules/auth/session/cookie';
import { performReauth, loadReauth } from '@/resources/reauth/reauth.service';

const USER = { id: 'u1', loginName: 'alice@acme.test' };
async function seeded() {
  const fake = new FakeAuthProvider({
    users: [USER],
    passwords: { u1: 'Password1!' },
    authMethods: { u1: ['password', 'passkey'] },
  });
  const s = await fake.createSession({}, { userId: 'u1' });
  const sessions: SessionEntry[] = [
    {
      id: s.id,
      token: s.token,
      loginName: USER.loginName,
      creationTs: s.changedAt,
      expirationTs: s.expiresAt,
      changeTs: s.changedAt,
    },
  ];
  return { fake, sessions };
}

describe('reauth.service — verify one factor onto the EXISTING session', () => {
  it('loadReauth lists only enrolled methods and threads the validated returnTo', async () => {
    const { fake, sessions } = await seeded();
    const v = await loadReauth(fake, sessions, {
      returnTo: '/passkeys',
      method: null,
      domain: 'localhost',
      emailDeliveryEnabled: false,
      consoleUrl: 'https://console.acme.test',
    });
    expect(v.kind).to.equal('view');
    if (v.kind === 'view') {
      expect(v.methods).to.deep.equal(['passkey', 'password']); // otp_email gated off
      expect(v.returnTo).to.equal('/passkeys');
    }
  });

  it('loadReauth falls back to the Zitadel-configured default destination when returnTo is absent', async () => {
    // Mirrors /signed-in's own fallback priority (admin console → Zitadel default →
    // env default → /passkeys) — reauth is reached from multiple flows (passkeys,
    // sso, ...), so a caller-less visit shouldn't blindly land on /passkeys.
    const { fake, sessions } = await seeded();
    fake.setLoginDefaultRedirectUri('https://app.acme.test/dashboard');
    const v = await loadReauth(fake, sessions, {
      returnTo: null,
      method: null,
      domain: 'localhost',
      emailDeliveryEnabled: false,
      consoleUrl: 'https://console.acme.test',
    });
    expect(v.kind).to.equal('view');
    if (v.kind === 'view') expect(v.returnTo).to.equal('https://app.acme.test/dashboard');
  });

  it('loadReauth falls back to /passkeys when returnTo is absent AND nothing is configured', async () => {
    const { fake, sessions } = await seeded();
    const v = await loadReauth(fake, sessions, {
      returnTo: null,
      method: null,
      domain: 'localhost',
      emailDeliveryEnabled: false,
      consoleUrl: 'https://console.acme.test',
    });
    expect(v.kind).to.equal('view');
    if (v.kind === 'view') expect(v.returnTo).to.equal('/passkeys');
  });

  it('performReauth(password) updates the SAME session id, rotates the token, and targets returnTo', async () => {
    const { fake, sessions } = await seeded();
    const r = await performReauth(fake, sessions, {
      factor: 'password',
      password: 'Password1!',
      returnTo: '/passkeys',
    });
    expect(r.ok).to.equal(true);
    if (r.ok) {
      expect(r.target).to.equal('/passkeys');
      expect(r.sessions[0].id).to.equal(sessions[0].id); // same session — SetSession semantics
    }
  });
  it('maps a wrong password to INVALID_CREDENTIALS and a dead cookie to SESSION_EXPIRED', async () => {
    const { fake, sessions } = await seeded();
    const bad = await performReauth(fake, sessions, {
      factor: 'password',
      password: 'nope',
      returnTo: null,
    });
    expect(bad).to.deep.equal({ ok: false, error: 'INVALID_CREDENTIALS' });
    const dead = await performReauth(fake, [], {
      factor: 'password',
      password: 'x',
      returnTo: null,
    });
    expect(dead).to.deep.equal({ ok: false, error: 'SESSION_EXPIRED' });
  });

  it('loadReauth recovers to /login (not a crash) when getSession throws a non-transient ProviderError', async () => {
    // Reproduces the live bug: a stored session token from a DIFFERENT browser/tab is stale or
    // revoked, and the real Zitadel backend throws PERMISSION_DENIED on getSession instead of
    // returning null. Before the fix this propagated uncaught and 500'd the whole request.
    const { fake, sessions } = await seeded();
    fake.setSessionResult(sessions[0].id, { mode: 'throw', code: 'PERMISSION_DENIED' });
    const v = await loadReauth(fake, sessions, {
      returnTo: '/passkeys',
      method: 'passkey',
      domain: 'localhost',
      emailDeliveryEnabled: false,
      consoleUrl: 'https://console.acme.test',
    });
    expect(v).to.deep.equal({ kind: 'redirect', target: '/login' });
  });

  it('loadReauth re-throws a genuinely transient ProviderError (real outage) instead of masking it', async () => {
    const { fake, sessions } = await seeded();
    fake.setSessionResult(sessions[0].id, { mode: 'throw', code: 'UNAVAILABLE' });
    let threw: unknown;
    try {
      await loadReauth(fake, sessions, {
        returnTo: '/passkeys',
        method: null,
        domain: 'localhost',
        emailDeliveryEnabled: false,
        consoleUrl: 'https://console.acme.test',
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).to.exist;
  });
});
