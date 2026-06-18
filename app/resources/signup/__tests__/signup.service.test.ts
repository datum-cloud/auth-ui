// app/resources/signup/__tests__/signup.service.test.ts
//
// Pass 2: migrated from routes/signup/__tests__/signup.test.ts. The original asserted
// the CODE-MIN-04 register-and-link behavior at the route action boundary; here we
// assert the identical behavior directly against the extracted service function,
// using the fake provider exactly as the original did.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import {
  completeEmailLinkSignup,
  registerAndLinkIdp,
  registerEmailLinkSignup,
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

describe('signup register-and-link path (CODE-MIN-04)', () => {
  it('register-and-link calls addIdpLink once and does not pass idpLink to register (CODE-MIN-04)', async () => {
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
});
