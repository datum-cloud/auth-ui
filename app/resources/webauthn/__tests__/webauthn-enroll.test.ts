// app/resources/webauthn/__tests__/webauthn-enroll.test.ts
// @vitest-environment node
//
// Spy-parity tests for the webauthn enrollment factory.
//
// createWebAuthnEnrollHandlers folds the byte-identical loader/action bodies of
// setup/passkey.tsx and setup/security-key.tsx into ONE parameterised factory.
// These tests pin the *provider sequence* each config drives so the fold is
// proven behaviour-preserving: the passkey config must call the same provider
// methods the old passkey route did (passkeyRegisterLink → registerPasskey) and
// the security-key config the same as the old U2F route (registerU2F) — and
// neither must reach into the other ceremony's provider methods.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import {
  createWebAuthnEnrollHandlers,
  PASSKEY_ENROLL_CONFIG,
  U2F_ENROLL_CONFIG,
} from '@/resources/webauthn/webauthn-enroll';
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

const LOGIN_NAME = 'alice@acme.test';

/** A signed sessions cookie header for the seeded fake user (passes the loader session guard). */
async function cookieFor(loginName = LOGIN_NAME) {
  const entry = {
    id: 's1',
    token: 't1',
    loginName,
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  };
  return (await sessionsCookie.serialize([entry])).split(';')[0];
}

// The factory reads providerForRequest(request) internally; the fake is the configured
// default. Tests still create the fake to spy on its provider methods (parity assertions).
async function runLoader(cfg: Parameters<typeof createWebAuthnEnrollHandlers>[0]) {
  const { loader } = createWebAuthnEnrollHandlers(cfg);
  const cookie = await cookieFor();
  const req = new Request(
    `http://localhost/id/setup/x?loginName=${encodeURIComponent(LOGIN_NAME)}`,
    { headers: { cookie } }
  );
  return loader({ request: req, params: {}, context: {} as never } as never);
}

describe('createWebAuthnEnrollHandlers — passkey config provider parity', () => {
  it('drives the passkey ceremony provider sequence (passkeyRegisterLink → registerPasskey), never U2F', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const link = vi.spyOn(fake, 'passkeyRegisterLink');
    const register = vi.spyOn(fake, 'registerPasskey');
    const u2f = vi.spyOn(fake, 'registerU2F');

    await runLoader(PASSKEY_ENROLL_CONFIG);

    expect(link).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
    expect(u2f).not.toHaveBeenCalled();
  });

  it('exposes passkeyId + challengeFailed in the loader data (passkey shape)', async () => {
    const res = await runLoader(PASSKEY_ENROLL_CONFIG);
    const d = (res as { data?: Record<string, unknown> }).data;
    expect(d).toBeDefined();
    expect(d).toHaveProperty('credentialId');
    expect(d).toHaveProperty('challengeFailed');
    expect(d?.loginName).toBe(LOGIN_NAME);
  });
});

describe('createWebAuthnEnrollHandlers — security-key config provider parity', () => {
  it('drives the U2F ceremony provider sequence (registerU2F), never the passkey methods', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const link = vi.spyOn(fake, 'passkeyRegisterLink');
    const register = vi.spyOn(fake, 'registerPasskey');
    const u2f = vi.spyOn(fake, 'registerU2F');

    await runLoader(U2F_ENROLL_CONFIG);

    expect(u2f).toHaveBeenCalledTimes(1);
    expect(link).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('exposes credentialId in the loader data (U2F shape, no challengeFailed)', async () => {
    const res = await runLoader(U2F_ENROLL_CONFIG);
    const d = (res as { data?: Record<string, unknown> }).data;
    expect(d).toBeDefined();
    expect(d).toHaveProperty('credentialId');
    expect(d?.loginName).toBe(LOGIN_NAME);
  });
});

describe('createWebAuthnEnrollHandlers — loader session guard parity', () => {
  it('redirects to /login when no session entry matches the loginName', async () => {
    const { loader } = createWebAuthnEnrollHandlers(PASSKEY_ENROLL_CONFIG);
    // No cookie → no session entry → the attestation service redirects to /login.
    const req = new Request('http://localhost/id/setup/x?loginName=ghost%40nowhere.test');
    const res = (await loader({
      request: req,
      params: {},
      context: {} as never,
    } as never)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });
});
