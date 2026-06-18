// @vitest-environment node
//
// Tests for:
// (A) /login action intent=email-link → 302 to /login/verify/email with set-cookie
// (B) /login/method loader → returns methods array with the expected options
//
// Must run in the node environment: happy-dom forbids setting the Cookie header,
// which breaks the CSRF round-trip.
import { action as loginAction } from '@/routes/login/index';
import { loader as methodLoader } from '@/routes/login/method';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// Enable email delivery so otp_email is treated as an available primary method
// in both the /login/method loader and decideAfterIdentifier.
vi.mock('@/utils/env/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env/env.server')>();
  return { ...actual, env: { ...actual.env, AUTH_EMAIL_DELIVERY_ENABLED: true } };
});

const ORIGIN = 'http://localhost';

/** Mint a valid CSRF token+cookie pair. */
async function mintCsrf(path = '/id/login') {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}${path}`));
  return { token, cookie: cookie! };
}

/** Build a POST Request with CSRF + any extra cookies. */
function postRequest(path: string, fields: Record<string, string>, cookies: string[]): Request {
  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { cookie: cookieHeader, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

function statusOf(res: unknown): number | undefined {
  if (res instanceof Response) return res.status;
  return (res as { init?: { status?: number } }).init?.status;
}

async function bodyOf(res: unknown): Promise<{ error?: string } | null> {
  if (res instanceof Response) {
    try {
      return (await res.json()) as { error?: string };
    } catch {
      return null;
    }
  }
  return (res as { data?: { error?: string } }).data ?? null;
}

function loaderArgs(url: string): Parameters<typeof methodLoader>[0] {
  return { request: new Request(url), params: {}, context: {} as never } as never;
}

function actionArgs(request: Request): Parameters<typeof loginAction>[0] {
  return { request, params: {}, context: {} as never } as never;
}

// ── (A) intent=email-link ──────────────────────────────────────────────────────

describe('login action — intent=email-link', () => {
  // u3 = email-otp-user@acme.test, authMethods: ['password', 'otp_email']
  // resolveIdentifier finds the user, creates a ceremony session, and returns ok.
  // The email-link branch ignores result.target and redirects to /login/verify/email.
  it('known user → 302 to /login/verify/email with set-cookie', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      '/id/login',
      { csrf: token, intent: 'email-link', loginName: 'email-otp-user@acme.test' },
      [cookie]
    );

    const res = (await loginAction(actionArgs(req))) as Response;

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^\/login\/verify\/email\?/);
    expect(location).toContain('loginName=email-otp-user%40acme.test');
    expect(res.headers.get('set-cookie')).toBeTruthy();
  });

  it('unknown user → 404 with USER_NOT_FOUND', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      '/id/login',
      { csrf: token, intent: 'email-link', loginName: 'nobody@acme.test' },
      [cookie]
    );

    const res = await loginAction(actionArgs(req));

    expect(statusOf(res)).toBe(404);
    expect((await bodyOf(res))?.error).toBe('USER_NOT_FOUND');
  });
});

// ── (B) /login/method loader ───────────────────────────────────────────────────

describe('/login/method loader', () => {
  // u7 = mfa2-user@acme.test, authMethods: ['password', 'totp', 'otp_email']
  // decideAfterIdentifier: password → available, otp_email → available → length 2 → method chooser.
  // totp is a 2nd factor (not a primary method), so decideAfterIdentifier ignores it.
  // The method screen therefore shows: password + otp_email.
  it('u7 mfa2-user@acme.test → methods contains password and otp_email', async () => {
    const url = `${ORIGIN}/id/login/method?loginName=mfa2-user%40acme.test`;
    const res = await methodLoader(loaderArgs(url));

    // Should not be a redirect
    expect(res).not.toBeInstanceOf(Response);

    const data = res as Awaited<ReturnType<typeof methodLoader>>;
    expect(data).toHaveProperty('methods');
    const methods = (data as { methods: string[] }).methods;
    expect(methods).toContain('password');
    expect(methods).toContain('otp_email');
  });

  // u3 = email-otp-user@acme.test, authMethods: ['password', 'otp_email']
  it('u3 email-otp-user@acme.test → methods contains password and otp_email', async () => {
    const url = `${ORIGIN}/id/login/method?loginName=email-otp-user%40acme.test`;
    const res = await methodLoader(loaderArgs(url));

    expect(res).not.toBeInstanceOf(Response);
    const methods = (res as { methods: string[] }).methods;
    expect(methods).toContain('password');
    expect(methods).toContain('otp_email');
    expect(methods.length).toBe(2);
  });

  it('unknown user → redirect to /login', async () => {
    const url = `${ORIGIN}/id/login/method?loginName=nobody%40acme.test`;
    const res = await methodLoader(loaderArgs(url));

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get('location')).toBe('/login');
  });

  it('missing loginName → redirect to /login', async () => {
    const url = `${ORIGIN}/id/login/method`;
    const res = await methodLoader(loaderArgs(url));

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get('location')).toBe('/login');
  });

  // u1 = alice@acme.test, authMethods: ['password'] — only 1 primary method.
  // decideAfterIdentifier would send her to /login/password, not /login/method.
  // The loader detects < 2 available and redirects to the single target.
  it('u1 alice@acme.test (password-only) → redirects away (< 2 methods)', async () => {
    const url = `${ORIGIN}/id/login/method?loginName=alice%40acme.test`;
    const res = await methodLoader(loaderArgs(url));

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    const loc = (res as Response).headers.get('location') ?? '';
    expect(loc).toContain('/login/password');
  });
});
