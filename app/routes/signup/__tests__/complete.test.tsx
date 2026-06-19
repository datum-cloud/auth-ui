// @vitest-environment node
//
// signup/complete — loader tests.
//
// Covers:
//   1. Valid code + userId → 302 to /setup/passkey with set-cookie header.
//   2. Missing code → 400 with error='EXPIRED'.
//   3. Missing userId → 400 with error='EXPIRED'.
//   4. Unknown userId (user not found) → 400 with error='EXPIRED'.
//   5. Bad/spent code → 400 with error='EXPIRED' (replay-safe).
//
// Uses a fresh FakeAuthProvider per test (NOT the singleton) so tests are isolated.
// AUTH_PROVIDER env is set to 'fake' so providerForRequest() uses the fake.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { loader } from '@/routes/signup/complete';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── env stub ────────────────────────────────────────────────────────────────
// Silence MaxMind (not relevant here) and point AUTH_PROVIDER at the fake.
vi.mock('@/utils/env/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env/env.server')>();
  return { ...actual, env: { ...actual.env, MAXMIND_ACCOUNT_ID: '' } };
});

// Override the module-level providerForRequest so each test can inject its own
// fresh FakeAuthProvider instance (the module-level singleton would leak state).
let fakeProvider: FakeAuthProvider;

vi.mock('@/server/auth-context.server', () => ({
  providerForRequest: () => fakeProvider,
}));

const ORIGIN = 'http://localhost';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): Request {
  const url = new URL('/signup/complete', ORIGIN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

async function runLoader(req: Request) {
  return loader({ request: req, params: {}, context: {} as never } as never);
}

function statusOf(res: unknown): number {
  if (res instanceof Response) return res.status;
  return (res as { init?: { status?: number } }).init?.status ?? 200;
}

async function bodyOf(res: unknown): Promise<Record<string, unknown> | null> {
  if (res instanceof Response) {
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return (res as { data?: Record<string, unknown> }).data ?? null;
}

function locationOf(res: unknown): string | null {
  if (res instanceof Response) return res.headers.get('Location');
  return null;
}

function setCookieOf(res: unknown): string | null {
  if (res instanceof Response) return res.headers.get('set-cookie');
  return null;
}

/** Collect all Set-Cookie values from a Response (node fetch merges them with ', '). */
function allSetCookiesOf(res: unknown): string[] {
  const raw = setCookieOf(res) ?? '';
  return raw ? raw.split(', ') : [];
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Fresh isolated provider for each test — avoids singleton state leakage.
  fakeProvider = new FakeAuthProvider();
});

// ─── Success path ─────────────────────────────────────────────────────────────

describe('signup/complete — success path', () => {
  it('redirects to /setup/passkey with set-cookie when code and userId are valid', async () => {
    // Register a user to get a deterministic code (email-<userId>)
    const user = await fakeProvider.register({
      email: 'test@acme.test',
      firstName: 'Test',
      lastName: 'User',
    });

    // The fake sets emailCodes[userId] = `email-${userId}` in register()
    const code = `email-${user.id}`;

    const req = makeRequest({ code, userId: user.id, next: 'passkey' });
    const res = await runLoader(req);

    expect(statusOf(res)).toBe(302);
    const location = locationOf(res) ?? '';
    expect(location).toMatch(/^\/setup\/passkey/);
    // Must emit the sessions cookie AND the last-used-login=email badge.
    const cookies = allSetCookiesOf(res);
    expect(cookies.some((c) => c.startsWith('sessions='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('last-used-login='))).toBe(true);
  });

  it('threads loginName and userId into the /setup/passkey redirect URL', async () => {
    const user = await fakeProvider.register({
      email: 'alice@acme.test',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    const code = `email-${user.id}`;

    const req = makeRequest({ code, userId: user.id, next: 'passkey' });
    const res = await runLoader(req);

    expect(statusOf(res)).toBe(302);
    const location = locationOf(res) ?? '';
    const url = new URL(location, ORIGIN);
    expect(url.pathname).toBe('/setup/passkey');
    expect(url.searchParams.get('loginName')).toBe('alice@acme.test');
    expect(url.searchParams.get('userId')).toBe(user.id);
  });

  it('threads organization into the redirect when present', async () => {
    const user = await fakeProvider.register({
      email: 'org-user@acme.test',
      firstName: 'Org',
      lastName: 'User',
      orgId: 'acme-org',
    });
    const code = `email-${user.id}`;

    const req = makeRequest({ code, userId: user.id, organization: 'acme-org', next: 'passkey' });
    const res = await runLoader(req);

    expect(statusOf(res)).toBe(302);
    const url = new URL(locationOf(res) ?? '', ORIGIN);
    expect(url.searchParams.get('organization')).toBe('acme-org');
  });
});

// ─── Expired / invalid link paths ─────────────────────────────────────────────

describe('signup/complete — expired/invalid link', () => {
  it('returns 400 with error=EXPIRED when code is missing', async () => {
    const user = await fakeProvider.register({
      email: 'nocode@acme.test',
      firstName: 'No',
      lastName: 'Code',
    });

    const req = makeRequest({ userId: user.id, next: 'passkey' });
    const res = await runLoader(req);

    expect(statusOf(res)).toBe(400);
    const body = await bodyOf(res);
    expect(body?.error).toBe('EXPIRED');
  });

  it('returns 400 with error=EXPIRED when userId is missing', async () => {
    const req = makeRequest({ code: 'some-code', next: 'passkey' });
    const res = await runLoader(req);

    expect(statusOf(res)).toBe(400);
    const body = await bodyOf(res);
    expect(body?.error).toBe('EXPIRED');
  });

  it('returns 400 with error=EXPIRED when userId does not resolve to a user', async () => {
    const req = makeRequest({ code: 'email-ghost', userId: 'ghost-id', next: 'passkey' });
    const res = await runLoader(req);

    expect(statusOf(res)).toBe(400);
    const body = await bodyOf(res);
    expect(body?.error).toBe('EXPIRED');
  });

  it('returns 400 with error=EXPIRED when code is wrong (replay-safe)', async () => {
    const user = await fakeProvider.register({
      email: 'replay@acme.test',
      firstName: 'Replay',
      lastName: 'Test',
    });

    const req = makeRequest({ code: 'wrong-code', userId: user.id, next: 'passkey' });
    const res = await runLoader(req);

    expect(statusOf(res)).toBe(400);
    const body = await bodyOf(res);
    expect(body?.error).toBe('EXPIRED');
  });

  it('returns 400 when code is empty string', async () => {
    const user = await fakeProvider.register({
      email: 'empty@acme.test',
      firstName: 'Empty',
      lastName: 'Code',
    });

    // Empty string is caught by the missing-code guard before provider calls.
    const req = makeRequest({ code: '', userId: user.id, next: 'passkey' });
    const res = await runLoader(req);

    expect(statusOf(res)).toBe(400);
    const body = await bodyOf(res);
    expect(body?.error).toBe('EXPIRED');
  });
});
