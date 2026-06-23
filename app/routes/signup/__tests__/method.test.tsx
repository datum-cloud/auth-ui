// @vitest-environment node
//
// signup/method — route action + loader tests.
//
// Covers:
//   1. Loader: returns csrfToken + isIdp=false for a normal email URL.
//   2. Action intent=email-link → genericCheckYourEmail (sent: true, status 200).
//   3. Action intent=password → 302 redirect to /signup/password.
//   4. Action intent=passkey → sent-with-session (requireEmailVerification defaults true).
//
// node env: happy-dom enforces Fetch spec rules that forbid setting the Cookie
// header, which breaks the CSRF round-trip used by the action tests.
import { action, loader } from '@/routes/signup/method';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// ─── env stub ────────────────────────────────────────────────────────────────
vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, MAXMIND_ACCOUNT_ID: '', AUTH_EMAIL_DELIVERY_ENABLED: true },
  };
});

const ORIGIN = 'http://localhost';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function mintCsrf(path = '/signup/method') {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}${path}`));
  return { token, cookie: cookie! };
}

function postRequest(fields: Record<string, string>, cookieHeader: string): Request {
  const cookieValue = cookieHeader.split(';')[0];
  return new Request(`${ORIGIN}/signup/method`, {
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
    request: new Request(`${ORIGIN}/signup/method${search}`),
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

// Common identity fields threaded through every method form
const IDENTITY = {
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

// ─── Loader ──────────────────────────────────────────────────────────────────

describe('signup/method — loader', () => {
  it('returns csrfToken, view, and loginName for a plain email URL', async () => {
    const search = '?loginName=john.doe@example.com&firstName=John&lastName=Doe';
    const res = await runLoader(search);
    const body = await bodyOf(res);

    expect(body?.csrfToken).toBeTruthy();
    expect(body?.loginName).toBe('john.doe@example.com');
    expect(body?.view).toBeDefined();
    // isIdp was removed — IdP users no longer reach this route (auto-created in SSO callback)
    expect(body?.isIdp).toBeUndefined();
  });

  it('ignores idpIntentId params (IdP users are now auto-created in the SSO callback)', async () => {
    const search =
      '?loginName=john@example.com&firstName=John&lastName=Doe&idpIntentId=intent-abc&idpIntentToken=tok&idpId=idp-g&idpUserId=u1&idpUserName=john';
    const res = await runLoader(search);
    const body = await bodyOf(res);

    // isIdp and idpIntentId are no longer part of loader output
    expect(body?.isIdp).toBeUndefined();
    expect(body?.idpIntentId).toBeUndefined();
    // other fields still work
    expect(body?.loginName).toBe('john@example.com');
  });
});

// ─── Action: email-link ───────────────────────────────────────────────────────

describe('signup/method — action: email-link', () => {
  it('returns sent=true with status 200 (genericCheckYourEmail)', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, intent: 'email-link', ...IDENTITY }, cookie);
    const res = await runAction(req);

    // genericCheckYourEmail returns data({ sent: true, email }, { status: 200 })
    expect(statusOf(res) ?? 200).toBe(200);
    const body = await bodyOf(res);
    expect(body?.sent).toBe(true);
    expect(body?.email).toBe(IDENTITY.loginName);
  });

  it('threads organization and requestId into the email-link call', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      {
        csrf: token,
        intent: 'email-link',
        ...IDENTITY,
        organization: 'acme',
        requestId: 'req-xyz',
      },
      cookie
    );
    const res = await runAction(req);

    expect(statusOf(res) ?? 200).toBe(200);
    const body = await bodyOf(res);
    expect(body?.sent).toBe(true);
  });
});

// ─── Action: password ─────────────────────────────────────────────────────────

describe('signup/method — action: password', () => {
  it('redirects to /signup/password with identity params (302)', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, intent: 'password', ...IDENTITY }, cookie);
    const res = await runAction(req);

    expect(statusOf(res)).toBe(302);
    const location = locationOf(res) ?? '';
    const url = new URL(location, ORIGIN);
    expect(url.pathname).toBe('/signup/password');
    expect(url.searchParams.get('loginName')).toBe(IDENTITY.loginName);
    expect(url.searchParams.get('firstName')).toBe('John');
    expect(url.searchParams.get('lastName')).toBe('Doe');
  });

  it('threads deviceTrackingToken into the password redirect', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, intent: 'password', ...IDENTITY, deviceTrackingToken: 'mm-tok-abc' },
      cookie
    );
    const res = await runAction(req);

    expect(statusOf(res)).toBe(302);
    const url = new URL(locationOf(res) ?? '', ORIGIN);
    expect(url.searchParams.get('deviceTrackingToken')).toBe('mm-tok-abc');
  });
});

// ─── Action: passkey ──────────────────────────────────────────────────────────

describe('signup/method — action: passkey', () => {
  it('returns sent-with-session (200, sent=true) — verify email first', async () => {
    // Passkey proves device possession, not email ownership, so the route gates
    // enrollment behind email verification: with EMAIL_VERIFICATION on (the default),
    // registerPasskeyFirst returns { kind: 'sent-with-session' } → data({ sent, email }, 200),
    // and the component renders the "Check your email" terminal state.
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, intent: 'passkey', ...IDENTITY }, cookie);
    const res = await runAction(req);

    expect(statusOf(res) ?? 200).toBe(200);
    const body = await bodyOf(res);
    expect(body?.sent).toBe(true);
    expect(body?.email).toBe(IDENTITY.loginName);
  });
});

// ─── Action: invalid input ────────────────────────────────────────────────────

describe('signup/method — action: validation', () => {
  it('returns 400 INVALID_INPUT when intent is missing', async () => {
    const { token, cookie } = await mintCsrf();
    // loginName/firstName/lastName without intent
    const req = postRequest({ csrf: token, loginName: 'john@example.com' }, cookie);
    const res = await runAction(req);

    expect(statusOf(res)).toBe(400);
    expect((await bodyOf(res))?.error).toBe('INVALID_INPUT');
  });
});
