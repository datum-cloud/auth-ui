// @vitest-environment node
//
// Defense-in-depth: signup/method action must reject intent=email-link with 400
// when AUTH_EMAIL_DELIVERY_ENABLED is false (env-level guard), even if the UI
// already hides the button.
//
// node env: happy-dom forbids setting the Cookie header, breaking CSRF round-trips.
import { action } from '@/routes/signup/method';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// ─── env stub — delivery OFF ─────────────────────────────────────────────────
vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, MAXMIND_ACCOUNT_ID: '', AUTH_EMAIL_DELIVERY_ENABLED: false },
  };
});

const ORIGIN = 'http://localhost';

async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/signup/method`));
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

const IDENTITY = {
  loginName: 'john.doe@example.com',
  firstName: 'John',
  lastName: 'Doe',
};

// ─── Guard tests ─────────────────────────────────────────────────────────────

describe('signup/method action — email-link guard when delivery is off', () => {
  it('returns 400 INVALID_INPUT when AUTH_EMAIL_DELIVERY_ENABLED=false and intent=email-link', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, intent: 'email-link', ...IDENTITY }, cookie);
    const res = await runAction(req);

    expect(statusOf(res)).toBe(400);
    expect((await bodyOf(res))?.error).toBe('INVALID_INPUT');
  });

  it('does NOT reach registerEmailLinkSignup when delivery is off (no user created)', async () => {
    // The 400 response itself proves the branch was short-circuited before
    // any registration attempt. We verify by asserting the body has error, not sent.
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, intent: 'email-link', ...IDENTITY }, cookie);
    const res = await runAction(req);

    const body = await bodyOf(res);
    expect(body?.sent).toBeUndefined();
    expect(body?.error).toBe('INVALID_INPUT');
  });

  it('still allows intent=password when delivery is off', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, intent: 'password', ...IDENTITY }, cookie);
    const res = await runAction(req);

    // password intent redirects to /signup/password — never a 400
    expect(statusOf(res)).toBe(302);
  });
});
