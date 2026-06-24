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
import { hashActor, logAuthEvent } from '@/server/observability';
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock observability so tests can intercept logAuthEvent calls (audit-shape characterization).
vi.mock('@/server/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/observability')>();
  return { ...actual, logAuthEvent: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(logAuthEvent).mockClear();
});

/** Find the first logAuthEvent call matching the given event name. */
function auditCall(event: string): [string, string, Record<string, unknown>?] | undefined {
  return vi.mocked(logAuthEvent).mock.calls.find((c) => c[0] === event) as
    | [string, string, Record<string, unknown>?]
    | undefined;
}

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

// ---------------------------------------------------------------------------
// Audit-event divergence characterization. registerPasskeyFirst and
// registerWithPassword share most of their flow BUT emit DIFFERENT audit on the
// no-verification success path — the merge must NOT collapse these:
//   - passkey-first  no-verify success → 'signup.requested' { actor: hash(email), organization }
//   - with-password  no-verify success → 'signup.created'   { userId, actor: hash(loginName) }
// Both require-verification + ALREADY_EXISTS paths emit 'signup.requested' identically.
// ---------------------------------------------------------------------------

describe('signup register audit-event shape (divergence guard)', () => {
  const base = {
    email: 'dave@acme.test',
    firstName: 'Dave',
    lastName: 'Acme',
    origin: 'https://auth.datum.test',
  };

  it("registerPasskeyFirst no-verify success emits 'signup.requested' with {actor, organization}", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const res = await registerPasskeyFirst(fake, [], {
      ...base,
      organization: 'org-z',
      requireVerification: false,
    });
    expect(res.kind).toBe('redirect');
    // The passkey path uses 'signup.requested', NOT 'signup.created'.
    expect(auditCall('signup.created')).toBeUndefined();
    const fields = auditCall('signup.requested')?.[2];
    expect(fields).toEqual({ actor: hashActor('dave@acme.test'), organization: 'org-z' });
    expect(fields).not.toHaveProperty('userId');
  });

  it("registerWithPassword no-verify success emits 'signup.created' with {userId, actor}", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const res = await registerWithPassword(fake, [], {
      ...base,
      password: 'hunter2hunter2',
      organization: 'org-z',
      requireVerification: false,
    });
    expect(res.kind).toBe('redirect');
    // The password path uses 'signup.created', carrying userId, and hashes loginName (not email).
    const fields = auditCall('signup.created')?.[2];
    expect(typeof fields?.userId).toBe('string');
    expect(fields?.userId).toBeTruthy();
    // fake sets loginName === email, so the hash matches either; the field key shape is what diverges.
    expect(fields?.actor).toBe(hashActor('dave@acme.test'));
    expect(fields).not.toHaveProperty('organization');
  });

  it("registerPasskeyFirst requireVerification success emits 'signup.requested' {actor, organization}", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const res = await registerPasskeyFirst(fake, [], {
      ...base,
      organization: 'org-z',
      requireVerification: true,
    });
    expect(res.kind).toBe('sent-with-session');
    expect(auditCall('signup.created')).toBeUndefined();
    expect(auditCall('signup.requested')?.[2]).toEqual({
      actor: hashActor('dave@acme.test'),
      organization: 'org-z',
    });
  });

  it("registerWithPassword requireVerification success emits 'signup.requested' {actor, organization}", async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const res = await registerWithPassword(fake, [], {
      ...base,
      password: 'hunter2hunter2',
      organization: 'org-z',
      requireVerification: true,
    });
    expect(res.kind).toBe('sent-with-session');
    // With verification ON, the password path also uses 'signup.requested' (NOT 'created').
    expect(auditCall('signup.created')).toBeUndefined();
    expect(auditCall('signup.requested')?.[2]).toEqual({
      actor: hashActor('dave@acme.test'),
      organization: 'org-z',
    });
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

  it('threads the new sessionId into /authorize when a requestId rides in (no select_account loop)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'register').mockResolvedValue({ id: 'u3', loginName: 'alice@acme.test' });
    vi.spyOn(fake, 'addIdpLink').mockResolvedValue(undefined as never);
    vi.spyOn(fake, 'createSession').mockResolvedValue({
      id: 'sess-link-1',
      token: 'sess-tok3',
      changedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    } as never);

    const r = await registerAndLinkIdp(fake, [], { ...idpInput(), requestId: 'oidc_abc' });

    expect(r.kind).toBe('redirect');
    if (r.kind === 'redirect') {
      // The just-created session id must hand back to /authorize so resolveOidc finishes the
      // callback via runCallback instead of bouncing a select_account/login ceremony to /accounts.
      expect(r.target).toContain('/authorize?requestId=oidc_abc');
      expect(r.target).toContain('sessionId=sess-link-1');
    }
  });

  it('lands on /signed-in (no sessionId) when no requestId rides in', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    vi.spyOn(fake, 'register').mockResolvedValue({ id: 'u4', loginName: 'alice@acme.test' });
    vi.spyOn(fake, 'addIdpLink').mockResolvedValue(undefined as never);
    vi.spyOn(fake, 'createSession').mockResolvedValue({
      id: 'sess-link-2',
      token: 'sess-tok4',
      changedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    } as never);

    const r = await registerAndLinkIdp(fake, [], idpInput());

    expect(r.kind).toBe('redirect');
    if (r.kind === 'redirect') {
      expect(r.target).toBe('/signed-in');
    }
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
