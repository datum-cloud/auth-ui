// app/resources/webauthn/__tests__/webauthn.service.test.ts
// @vitest-environment node
//
// Pass 2 service tests for the webauthn domain. These port the behavioral
// assertions from the former route test (routes/setup/__tests__/passkey.test.ts)
// down to the service boundary, calling requestPasskeyAttestation directly against
// the fake provider singleton.
//
// The route test minted a real sessions cookie + Request so the loader's session
// guard would pass; at the service boundary we hand requestPasskeyAttestation the
// already-read SessionEntry[] directly (the route still owns cookie/CSRF I/O). The
// loader unwraps `publicKey` from `publicKeyCredentialCreationOptions` — the
// service returns the RAW options, so the original `publicKey === null` assertion
// becomes `publicKeyCredentialCreationOptions === null` here (the route's null
// passes straight through the unwrap).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import type { SessionEntry } from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import {
  requestPasskeyAttestation,
  verifyPasskeyEnrollment,
  verifyU2FEnrollment,
} from '@/resources/webauthn/webauthn.service';
import { hashActor, logAuthEvent } from '@/server/observability';
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock observability so tests can intercept logAuthEvent calls.
vi.mock('@/server/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/observability')>();
  return { ...actual, logAuthEvent: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(logAuthEvent).mockClear();
});

/** A single valid session entry for the given loginName (mirrors the cookie the route guard requires). */
function sessionsFor(loginName = 'alice@acme.test', organization?: string): SessionEntry[] {
  return [
    {
      id: 's1',
      token: 't1',
      loginName,
      organization,
      creationTs: '2026-01-01T00:00:00.000Z',
      expirationTs: '2099-01-01T00:00:00.000Z',
      changeTs: '2026-01-01T00:00:00.000Z',
    },
  ];
}

const DOMAIN = 'localhost';

/**
 * Run requestPasskeyAttestation with the given loginName.
 * Supplies a valid session entry so the session guard passes (the fake's findUser
 * resolves the seeded user for the loginName).
 */
function runRequestPasskeyAttestation(provider: FakeAuthProvider, loginName = 'alice@acme.test') {
  return requestPasskeyAttestation(provider, sessionsFor(loginName), {
    loginName,
    domain: DOMAIN,
  });
}

// ---------------------------------------------------------------------------
// Log challenge error reason + hash actor
// ---------------------------------------------------------------------------

describe('requestPasskeyAttestation — challenge failure audit', () => {
  it('logs a reason and a hashed actor when the challenge fails', async () => {
    // Arrange: fake provider's passkeyRegisterLink rejects.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'passkeyRegisterLink').mockRejectedValue(new Error('zitadel down'));

    // Act: the service should NOT throw — it degrades gracefully with publicKey=null.
    await runRequestPasskeyAttestation(fake, 'alice@acme.test');

    // Assert: a failure audit event must have been emitted.
    const calls = vi.mocked(logAuthEvent).mock.calls;
    const failureCall = calls.find(
      ([event, outcome]) => event === 'mfa_enroll_challenge' && outcome === 'failure'
    );
    expect(failureCall).toBeDefined();

    const fields = failureCall?.[2] as Record<string, unknown> | undefined;

    // a non-ProviderError failure maps to the typed 'UNKNOWN' code.
    expect(fields?.code).toBe('UNKNOWN');

    // raw loginName must NOT appear in the fields.
    expect(fields?.loginName).toBeUndefined();

    // actor must be a hashed string.
    expect(typeof fields?.actor).toBe('string');
  });

  it('logs the typed ProviderError code and surfaces challengeFailed in the result', async () => {
    // Arrange: fake provider's passkeyRegisterLink rejects with a typed ProviderError.
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'passkeyRegisterLink').mockRejectedValue(
      new ProviderError('UNAVAILABLE', 'zitadel down')
    );

    // Act: the service degrades gracefully (no throw) and reports the failure to the UI.
    const result = await runRequestPasskeyAttestation(fake, 'alice@acme.test');

    // Assert: a visible enrollment-failure state is surfaced in the result. The route
    // unwraps `publicKey` from publicKeyCredentialCreationOptions, so a null options
    // value passes straight through to publicKey=null.
    expect(result.kind).toBe('challenge');
    if (result.kind !== 'challenge') throw new Error('expected a challenge result');
    expect(result.challengeFailed).toBe(true);
    expect(result.publicKeyCredentialCreationOptions).toBeNull();

    // Assert: the failure audit carries the TYPED ProviderError code, a hashed actor, and the factor.
    const failureCall = vi
      .mocked(logAuthEvent)
      .mock.calls.find(
        ([event, outcome]) => event === 'mfa_enroll_challenge' && outcome === 'failure'
      );
    const fields = failureCall?.[2] as Record<string, unknown> | undefined;
    expect(fields?.code).toBe('UNAVAILABLE');
    expect(fields?.factor).toBe('passkey');
    expect(fields?.actor).toBe(hashActor('alice@acme.test'));
    // raw loginName must NOT appear.
    expect(fields?.loginName).toBeUndefined();
  });

  it("uses 'UNKNOWN' code for a non-ProviderError challenge failure", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'passkeyRegisterLink').mockRejectedValue(new Error('boom'));

    await runRequestPasskeyAttestation(fake, 'alice@acme.test');

    const failureCall = vi
      .mocked(logAuthEvent)
      .mock.calls.find(
        ([event, outcome]) => event === 'mfa_enroll_challenge' && outcome === 'failure'
      );
    const fields = failureCall?.[2] as Record<string, unknown> | undefined;
    expect(fields?.code).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// verifyPasskeyEnrollment / verifyU2FEnrollment — characterization of the
// divergences the parameterized merge MUST preserve:
//   - distinct provider call (verifyPasskey(userId, passkeyId, cred) vs
//     verifyU2F(userId, { u2fId, publicKeyCredential, tokenName: '' }))
//   - distinct audit `factor` ('passkey' vs 'u2f')
//   - distinct checkAfter target (/login/passkey vs /login/security-key)
//   - malformed JSON → INVALID_INPUT; INVALID_CREDENTIALS ProviderError → typed error
// ---------------------------------------------------------------------------

const VALID_CRED = JSON.stringify({ id: 'cred-1' });

describe('verifyPasskeyEnrollment', () => {
  it("checkAfter='true' routes into /login/passkey threading the raw params", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const res = await verifyPasskeyEnrollment(fake, sessionsFor('alice@acme.test', 'org-1'), {
      credential: VALID_CRED,
      passkeyId: 'pk-1',
      loginName: 'alice@acme.test',
      requestId: 'req-9',
      organization: 'org-1',
      checkAfter: 'true',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.target).toContain('/login/passkey?');
    expect(res.target).toContain('loginName=alice%40acme.test');
    expect(res.target).toContain('requestId=req-9');
    expect(res.target).toContain('organization=org-1');
  });

  it('calls provider.verifyPasskey with (userId, passkeyId, parsedCredential)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'verifyPasskey');
    await verifyPasskeyEnrollment(fake, sessionsFor(), {
      credential: VALID_CRED,
      passkeyId: 'pk-1',
      loginName: 'alice@acme.test',
      checkAfter: 'true',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [userId, passkeyId, cred] = spy.mock.calls[0];
    expect(typeof userId).toBe('string');
    expect(passkeyId).toBe('pk-1');
    expect(cred).toEqual({ id: 'cred-1' });
  });

  it('malformed credential JSON → INVALID_INPUT (no provider call)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'verifyPasskey');
    const res = await verifyPasskeyEnrollment(fake, sessionsFor(), {
      credential: 'not-json',
      passkeyId: 'pk-1',
      loginName: 'alice@acme.test',
    });
    expect(res).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(spy).not.toHaveBeenCalled();
  });

  it("INVALID_CREDENTIALS ProviderError → typed error + failure audit factor='passkey'", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'verifyPasskey').mockRejectedValue(
      new ProviderError('INVALID_CREDENTIALS', 'bad cred')
    );
    const res = await verifyPasskeyEnrollment(fake, sessionsFor(), {
      credential: VALID_CRED,
      passkeyId: 'pk-1',
      loginName: 'alice@acme.test',
    });
    expect(res).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' });
    const failureCall = vi
      .mocked(logAuthEvent)
      .mock.calls.find(([event, outcome]) => event === 'mfa_enroll' && outcome === 'failure');
    expect((failureCall?.[2] as Record<string, unknown>)?.factor).toBe('passkey');
  });

  it('unset SESSION_EXPIRED when no matching session entry', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const res = await verifyPasskeyEnrollment(fake, [], {
      credential: VALID_CRED,
      passkeyId: 'pk-1',
      loginName: 'alice@acme.test',
    });
    expect(res).toEqual({ ok: false, error: 'SESSION_EXPIRED' });
  });
});

describe('verifyU2FEnrollment', () => {
  it("checkAfter='true' routes into /login/security-key threading the raw params", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const res = await verifyU2FEnrollment(fake, sessionsFor('alice@acme.test', 'org-1'), {
      credential: VALID_CRED,
      u2fId: 'u2f-1',
      loginName: 'alice@acme.test',
      requestId: 'req-9',
      organization: 'org-1',
      checkAfter: 'true',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.target).toContain('/login/security-key?');
    expect(res.target).toContain('loginName=alice%40acme.test');
    expect(res.target).toContain('requestId=req-9');
    expect(res.target).toContain('organization=org-1');
  });

  it('calls provider.verifyU2F with the wrapped credential payload', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'verifyU2F');
    await verifyU2FEnrollment(fake, sessionsFor(), {
      credential: VALID_CRED,
      u2fId: 'u2f-7',
      loginName: 'alice@acme.test',
      checkAfter: 'true',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [userId, payload] = spy.mock.calls[0];
    expect(typeof userId).toBe('string');
    expect(payload).toEqual({
      u2fId: 'u2f-7',
      publicKeyCredential: { id: 'cred-1' },
      tokenName: '',
    });
  });

  it('malformed credential JSON → INVALID_INPUT (no provider call)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'verifyU2F');
    const res = await verifyU2FEnrollment(fake, sessionsFor(), {
      credential: 'not-json',
      u2fId: 'u2f-1',
      loginName: 'alice@acme.test',
    });
    expect(res).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(spy).not.toHaveBeenCalled();
  });

  it("INVALID_CREDENTIALS ProviderError → typed error + failure audit factor='u2f'", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'verifyU2F').mockRejectedValue(
      new ProviderError('INVALID_CREDENTIALS', 'bad cred')
    );
    const res = await verifyU2FEnrollment(fake, sessionsFor(), {
      credential: VALID_CRED,
      u2fId: 'u2f-1',
      loginName: 'alice@acme.test',
    });
    expect(res).toEqual({ ok: false, error: 'INVALID_CREDENTIALS' });
    const failureCall = vi
      .mocked(logAuthEvent)
      .mock.calls.find(([event, outcome]) => event === 'mfa_enroll' && outcome === 'failure');
    expect((failureCall?.[2] as Record<string, unknown>)?.factor).toBe('u2f');
  });

  it('unset SESSION_EXPIRED when no matching session entry', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const res = await verifyU2FEnrollment(fake, [], {
      credential: VALID_CRED,
      u2fId: 'u2f-1',
      loginName: 'alice@acme.test',
    });
    expect(res).toEqual({ ok: false, error: 'SESSION_EXPIRED' });
  });
});
