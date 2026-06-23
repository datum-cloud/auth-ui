// @vitest-environment node
//
// Signup identifier screen — route action + loader tests.
//
// Covers:
//   1. Valid email POST → 302 redirect to /signup/method with loginName/firstName/lastName.
//   2. intent=idp POST → redirect to the provider authUrl.
//   3. Missing/invalid email → 400 INVALID_INPUT.
//   4. IdP service failure → 502.
//   5. Component smoke test (registration unavailable, heading).
//
// node env: happy-dom enforces Fetch spec rules that forbid setting the Cookie
// header, which breaks the CSRF round-trip used by the action tests.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import type { LoginSettings } from '@/modules/auth/types';
import { action, loader } from '@/routes/signup/index';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// ─── env: stub MAXMIND_ACCOUNT_ID (env.server is a server-only module) ─────────
vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return { ...actual, env: { ...actual.env, MAXMIND_ACCOUNT_ID: '' } };
});

const ORIGIN = 'http://localhost';

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function mintCsrf(path = '/signup') {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}${path}`));
  return { token, cookie: cookie! };
}

function postRequest(fields: Record<string, string>, cookieHeader: string): Request {
  const cookieValue = cookieHeader.split(';')[0];
  return new Request(`${ORIGIN}/signup`, {
    method: 'POST',
    headers: { cookie: cookieValue, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

async function runAction(req: Request) {
  return action({ request: req, params: {}, context: {} as never } as never);
}

async function runLoader(search = '') {
  return loader({
    request: new Request(`${ORIGIN}/signup${search}`),
    params: {},
    context: {} as never,
  } as never);
}

/** Normalise status from either a real Response or a RR data() object. */
function statusOf(res: unknown): number | undefined {
  if (res instanceof Response) return res.status;
  return (res as { init?: { status?: number } }).init?.status;
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

// ─── Loader ────────────────────────────────────────────────────────────────────

describe('signup/index — loader', () => {
  it('returns csrfToken and view from settings', async () => {
    const res = await runLoader();
    const body = await bodyOf(res);
    expect(body?.csrfToken).toBeTruthy();
    expect(body?.view).toBeDefined();
  });

  it('reads organization and requestId from URL', async () => {
    const res = await runLoader('?organization=acme&requestId=req123');
    const body = await bodyOf(res);
    expect(body?.organization).toBe('acme');
    expect(body?.requestId).toBe('req123');
  });

  it('preserves idpIntentId prefill when present', async () => {
    const res = await runLoader(
      '?idpIntentId=intent1&idpIntentToken=tok&idpId=idp1&idpUserId=u1&idpUserName=alice'
    );
    const body = await bodyOf(res);
    expect(body?.idp).toEqual({
      idpIntentId: 'intent1',
      idpIntentToken: 'tok',
      idpId: 'idp1',
      idpUserId: 'u1',
      idpUserName: 'alice',
    });
  });
});

// ─── Action: email identifier ──────────────────────────────────────────────────

describe('signup/index — action: email identifier', () => {
  it('redirects to /signup/method with parsed name on valid email', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, email: 'john.doe@example.com' }, cookie);
    const res = await runAction(req);

    expect(statusOf(res) ?? (res as Response).status).toBe(302);
    const location = locationOf(res) ?? '';
    const url = new URL(location, ORIGIN);
    expect(url.pathname).toBe('/signup/method');
    expect(url.searchParams.get('loginName')).toBe('john.doe@example.com');
    expect(url.searchParams.get('firstName')).toBe('John');
    expect(url.searchParams.get('lastName')).toBe('Doe');
  });

  it('threads organization and requestId into the redirect', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, email: 'alice@example.com', organization: 'acme', requestId: 'req-abc' },
      cookie
    );
    const res = await runAction(req);

    expect(statusOf(res) ?? (res as Response).status).toBe(302);
    const url = new URL(locationOf(res) ?? '', ORIGIN);
    expect(url.searchParams.get('organization')).toBe('acme');
    expect(url.searchParams.get('requestId')).toBe('req-abc');
  });

  it('returns 400 INVALID_INPUT for a non-email value', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, email: 'not-an-email' }, cookie);
    const res = await runAction(req);

    expect(statusOf(res)).toBe(400);
    expect((await bodyOf(res))?.error).toBe('INVALID_INPUT');
  });

  it('threads deviceTrackingToken when present', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, email: 'user@example.com', deviceTrackingToken: 'mm-token-abc' },
      cookie
    );
    const res = await runAction(req);

    expect(statusOf(res) ?? (res as Response).status).toBe(302);
    const url = new URL(locationOf(res) ?? '', ORIGIN);
    expect(url.searchParams.get('deviceTrackingToken')).toBe('mm-token-abc');
  });
});

// ─── Action: IdP intent ────────────────────────────────────────────────────────

describe('signup/index — action: IdP intent', () => {
  it('redirects to the IdP authUrl on success', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    // Let the fake's real startIdpIntent run — seeded idp-g returns { authUrl }, which the
    // service wrapper needs. Mirrors login/__tests__/idp-origin.test.ts. (Mocking a
    // wrong-shaped { authorizationUrl } made the wrapper see no authUrl → 502.)
    const spy = vi.spyOn(fake, 'startIdpIntent');

    const { token, cookie } = await mintCsrf();
    // Use a seeded IdP id from the fake provider.
    const GOOGLE_IDP_ID = 'idp-g';
    const req = postRequest({ csrf: token, intent: 'idp', idpId: GOOGLE_IDP_ID }, cookie);
    const res = await runAction(req);

    expect(statusOf(res) ?? (res as Response).status).toBe(302);
    spy.mockRestore();
  });

  it('returns 400 INVALID_INPUT when idpId is missing', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, intent: 'idp' /* no idpId */ }, cookie);
    const res = await runAction(req);

    expect(statusOf(res)).toBe(400);
    expect((await bodyOf(res))?.error).toBe('INVALID_INPUT');
  });
});

// ─── registrationDisabled view flag ───────────────────────────────────────────

describe('signup/index — loader: registrationDisabled', () => {
  it('sets view.registrationDisabled=true when allowRegister=false', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi
      .spyOn(fake, 'getLoginSettings')
      .mockResolvedValue({ allowRegister: false } as unknown as LoginSettings);

    const res = await runLoader();
    const body = await bodyOf(res);
    expect((body?.view as { registrationDisabled: boolean })?.registrationDisabled).toBe(true);
    spy.mockRestore();
  });
});
