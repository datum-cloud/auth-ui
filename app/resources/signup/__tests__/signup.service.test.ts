// app/resources/signup/__tests__/signup.service.test.ts
//
// Pass 2: migrated from routes/signup/__tests__/signup.test.ts. The original asserted
// the register-and-link behavior at the route action boundary; here we
// assert the identical behavior directly against the extracted service function,
// using the fake provider exactly as the original did.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import {
  completeEmailLinkSignup,
  registerAndLinkIdp,
  registerEmailLinkSignup,
  registerPasskeyFirst,
  registerWithPassword,
} from '@/resources/signup';
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

/** The IdP register-and-link inputs the original route test POSTed. */
function idpInput(overrides: Record<string, string> = {}) {
  return {
    email: 'alice@acme.test',
    firstName: 'Alice',
    lastName: 'Acme',
    idpIntentId: 'intent1',
    idpIntentToken: 'tok1',
    idpId: 'idp1',
    idpUserId: 'idpUser1',
    idpUserName: 'alice_idp',
    ...overrides,
  };
}

describe('signup register-with-password — MaxMind token → session metadata', () => {
  const baseInput = {
    email: 'bob@acme.test',
    firstName: 'Bob',
    lastName: 'Acme',
    password: 'hunter2hunter2',
    requireVerification: false,
    origin: 'https://auth.datum.test',
  };

  it('forwards deviceTrackingToken as metadata["maxmind/tracking-token"] plus userId', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    await registerWithPassword(fake, [], { ...baseInput, deviceTrackingToken: 'tok' });
    expect(fake.lastCreateSessionOpts?.metadata).toEqual({ 'maxmind/tracking-token': 'tok' });
    expect(typeof fake.lastCreateSessionOpts?.userId).toBe('string');
    expect(fake.lastCreateSessionOpts?.userId).toBeTruthy();
  });

  it('sets no metadata when deviceTrackingToken is absent', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    await registerWithPassword(fake, [], baseInput);
    expect(fake.lastCreateSessionOpts?.metadata).toBeUndefined();
    expect(fake.lastCreateSessionOpts?.userId).toBeTruthy();
  });

  it('forwards userAgent to createSession', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const ua = {
      fingerprintId: 'fp-abc',
      ip: '1.2.3.4',
      description: 'Chrome, , , , Blink, , macOS, , ',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    await registerWithPassword(fake, [], { ...baseInput, userAgent: ua });
    expect(fake.lastCreateSessionOpts?.userAgent).toEqual(ua);
  });
});

describe('registerEmailLinkSignup', () => {
  it('registers passwordless and returns sent for a new email', async () => {
    const p = new FakeAuthProvider({ users: [] });
    const r = await registerEmailLinkSignup(p, [], {
      email: 'new@x.com',
      firstName: 'New',
      lastName: 'User',
      origin: 'https://auth.test',
    });
    expect(r).toEqual({ kind: 'sent', email: 'new@x.com' });
  });

  it('returns the identical sent result for an existing email (no enumeration)', async () => {
    const p = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'dupe@x.com', displayName: 'Dupe' }],
    });
    const r = await registerEmailLinkSignup(p, [], {
      email: 'dupe@x.com',
      firstName: 'Dupe',
      lastName: 'Dupe',
      origin: 'https://auth.test',
    });
    expect(r).toEqual({ kind: 'sent', email: 'dupe@x.com' });
  });
});

describe('registerPasskeyFirst — userAgent forwarded to createSession', () => {
  it('passes userAgent to createSession when provided (requireVerification=false)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const ua = {
      fingerprintId: 'fp-passkey',
      ip: '1.2.3.4',
      description: 'Chrome, , , , Blink, , macOS, , ',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    await registerPasskeyFirst(fake, [], {
      email: 'carol@acme.test',
      firstName: 'Carol',
      lastName: 'Acme',
      requireVerification: false,
      origin: 'https://auth.datum.test',
      userAgent: ua,
    });
    expect(fake.lastCreateSessionOpts?.userAgent).toEqual(ua);
  });
});

describe('signup register-and-link path', () => {
  it('register-and-link calls addIdpLink once and does not pass idpLink to register', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

    const registerCalls: unknown[] = [];
    const addIdpLinkCalls: unknown[] = [];

    vi.spyOn(fake, 'register').mockImplementation(async (input) => {
      registerCalls.push(input);
      return { id: 'u1', loginName: 'alice@acme.test' };
    });
    vi.spyOn(fake, 'addIdpLink').mockImplementation(async (...args) => {
      addIdpLinkCalls.push(args);
    });
    vi.spyOn(fake, 'createSession').mockResolvedValue({
      id: 'sess1',
      token: 'sess-tok',
      changedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    } as never);

    await registerAndLinkIdp(fake, [], idpInput());

    expect(registerCalls[0]).not.toHaveProperty('idpLink');
    expect(addIdpLinkCalls).toHaveLength(1);
  });

  it('forwards userAgent to createSession', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const ua = {
      fingerprintId: 'fp-idp',
      ip: '1.2.3.4',
      description: 'Chrome, , , , Blink, , macOS, , ',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    vi.spyOn(fake, 'register').mockResolvedValue({ id: 'u2', loginName: 'alice@acme.test' });
    vi.spyOn(fake, 'addIdpLink').mockResolvedValue(undefined as never);
    vi.spyOn(fake, 'createSession').mockResolvedValue({
      id: 'sess2',
      token: 'sess-tok2',
      changedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    } as never);

    await registerAndLinkIdp(fake, [], { ...idpInput(), userAgent: ua });

    expect(fake.createSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userAgent: ua })
    );
  });
});

describe('completeEmailLinkSignup', () => {
  it('verifies email, enrolls otpEmail, self-authenticates, returns a redirect + session', async () => {
    const p = new FakeAuthProvider({ users: [] });
    // register() sets emailCodes.set(id, `email-${id}`) — the fake's first user gets
    // id 'user-1' (seq increments from 0). Pass that deterministic code to verifyEmail.
    const user = await p.register({ email: 'new@x.com', firstName: 'New', lastName: 'User' });
    const verifyCode = `email-${user.id}`;
    const r = await completeEmailLinkSignup(p, [], {
      userId: user.id,
      code: verifyCode,
      loginName: 'new@x.com',
      next: 'passkey',
    });
    expect(r.kind).toBe('redirect');
    if (r.kind === 'redirect') {
      expect(r.target).toContain('/setup/passkey');
      expect(r.target).toContain('checkAfter=false');
      expect(r.sessions.length).toBe(1);
    }
  });

  it('forwards userAgent to createSession', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const ua = {
      fingerprintId: 'fp-complete',
      ip: '1.2.3.4',
      description: 'Chrome, , , , Blink, , macOS, , ',
      header: { 'user-agent': { values: ['Mozilla/5.0'] } },
    };
    // Register a user so verifyEmail has a valid code
    const user = await fake.register({ email: 'comp@x.com', firstName: 'C', lastName: 'D' });
    const verifyCode = `email-${user.id}`;
    await completeEmailLinkSignup(fake, [], {
      userId: user.id,
      code: verifyCode,
      loginName: 'comp@x.com',
      userAgent: ua,
    });
    expect(fake.lastCreateSessionOpts?.userAgent).toEqual(ua);
  });
});
