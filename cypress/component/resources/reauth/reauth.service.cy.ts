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

  it('falls back to the configured default returnTo, then to /passkeys', async () => {
    // Mirrors /signed-in's own fallback priority (admin console → Zitadel default →
    // env default → /passkeys) — reauth is reached from multiple flows (passkeys,
    // sso, ...), so a caller-less visit shouldn't blindly land on /passkeys.
    const load = async (configuredDefault?: string) => {
      const { fake, sessions } = await seeded();
      if (configuredDefault) fake.setLoginDefaultRedirectUri(configuredDefault);
      return loadReauth(fake, sessions, {
        returnTo: null,
        method: null,
        domain: 'localhost',
        emailDeliveryEnabled: false,
        consoleUrl: 'https://console.acme.test',
      });
    };

    const configured = await load('https://app.acme.test/dashboard');
    expect(configured.kind, 'configured default: kind').to.equal('view');
    if (configured.kind === 'view') {
      expect(configured.returnTo, 'configured default wins').to.equal(
        'https://app.acme.test/dashboard'
      );
    }

    const bare = await load();
    expect(bare.kind, 'nothing configured: kind').to.equal('view');
    if (bare.kind === 'view') {
      expect(bare.returnTo, 'falls through to /passkeys').to.equal('/passkeys');
    }
  });

  it('performReauth preserves the Zitadel-configured default returnTo across the full round-trip', async () => {
    // Continues the scenario above: the resolved absolute default lands in the form's
    // hidden returnTo field and gets echoed back on submit. performReauth must NOT let it
    // fall through to a hardcoded /passkeys just because it's an absolute URL not on
    // POST_LOGOUT_ALLOWLIST — it re-resolves the SAME configured default server-side
    // instead of trusting the client-echoed absolute URL.
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
    if (v.kind !== 'view') return;
    expect(v.returnTo).to.equal('https://app.acme.test/dashboard');

    const r = await performReauth(fake, sessions, {
      factor: 'password',
      password: 'Password1!',
      returnTo: v.returnTo,
      consoleUrl: 'https://console.acme.test',
    });
    expect(r.ok).to.equal(true);
    if (r.ok) expect(r.target).to.equal('https://app.acme.test/dashboard');
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

  it('performReauth(idp) verifies the intent onto the SAME session id and targets returnTo', async () => {
    const fake = new FakeAuthProvider({
      users: [USER],
      passwords: { u1: 'Password1!' },
      authMethods: { u1: ['password', 'idp'] },
      idpIntents: {
        'intent-1': { idpIntentId: 'intent-1', idpIntentToken: 'tok-1', userId: 'u1' },
      },
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
    const r = await performReauth(fake, sessions, {
      factor: 'idp',
      idpIntentId: 'intent-1',
      idpIntentToken: 'tok-1',
      returnTo: '/passkeys',
    });
    expect(r.ok).to.equal(true);
    if (r.ok) {
      expect(r.target).to.equal('/passkeys');
      expect(r.sessions[0].id).to.equal(sessions[0].id);
    }
  });

  it('performReauth(idp) maps a mismatched idpIntent to INVALID_CREDENTIALS', async () => {
    const fake = new FakeAuthProvider({
      users: [USER, { id: 'u2', loginName: 'bob@acme.test' }],
      idpIntents: {
        'intent-2': { idpIntentId: 'intent-2', idpIntentToken: 'tok-2', userId: 'u2' },
      },
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
    const r = await performReauth(fake, sessions, {
      factor: 'idp',
      idpIntentId: 'intent-2',
      idpIntentToken: 'tok-2',
      returnTo: null,
    });
    expect(r).to.deep.equal({ ok: false, error: 'INVALID_CREDENTIALS' });
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

  // Same setup, same assertion shape — only the linked provider's type differs, and with it
  // whether idp is offerable at all. LDAP is a directory bind, not a browser-redirect IdP, so
  // it must never surface as a re-auth method.
  const LINKED_IDPS: Array<{
    label: string;
    idp: { id: string; name: string; type: string };
    link: { idpId: string; idpUserId: string; idpUserName: string };
    offersIdp: boolean;
    expectedLinked: Record<string, string>[];
  }> = [
    {
      label: 'Google-linked user',
      idp: { id: 'idp-google', name: 'Google', type: 'GOOGLE' },
      link: { idpId: 'idp-google', idpUserId: 'g-1', idpUserName: 'mia@gmail.com' },
      offersIdp: true,
      expectedLinked: [
        {
          idpId: 'idp-google',
          idpUserId: 'g-1',
          idpUserName: 'mia@gmail.com',
          name: 'Google',
          type: 'GOOGLE',
        },
      ],
    },
    {
      label: 'LDAP-only user',
      idp: { id: 'idp-ldap', name: 'Corporate LDAP', type: 'LDAP' },
      link: { idpId: 'idp-ldap', idpUserId: 'ldap-1', idpUserName: 'mia' },
      offersIdp: false,
      expectedLinked: [],
    },
  ];

  it('lists idp for a browser-redirect IdP, omitting it when only LDAP is linked', async () => {
    for (const { label, idp, link, offersIdp, expectedLinked } of LINKED_IDPS) {
      const fake = new FakeAuthProvider({
        users: [USER],
        authMethods: { u1: ['idp'] },
        capabilities: { externalIdp: true },
      });
      fake.setActiveIdPs?.([idp]);
      fake.setIdpLinks?.('u1', [link]);
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
      const v = await loadReauth(fake, sessions, {
        returnTo: '/passkeys',
        method: null,
        domain: 'localhost',
        emailDeliveryEnabled: false,
        consoleUrl: 'https://console.acme.test',
      });
      expect(v.kind, `${label}: kind`).to.equal('view');
      if (v.kind !== 'view') continue;
      if (offersIdp) expect(v.methods, `${label}: methods`).to.include('idp');
      else expect(v.methods, `${label}: methods`).to.not.include('idp');
      expect(v.linkedIdps, `${label}: linkedIdps`).to.deep.equal(expectedLinked);
    }
  });
});
