// @vitest-environment node
//
// Defense-in-depth: /login action must reject intent=email-link with 400
// when AUTH_EMAIL_DELIVERY_ENABLED is false, even if the UI already hides the
// "Email me a sign-in link" button.
//
// node env: happy-dom forbids setting the Cookie header, breaking CSRF round-trips.
import { action } from '@/routes/login/index';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// ─── env stub — delivery OFF ─────────────────────────────────────────────────
vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, AUTH_EMAIL_DELIVERY_ENABLED: false },
  };
});

const ORIGIN = 'http://localhost';

async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/id/login`));
  return { token, cookie: cookie! };
}

function postRequest(fields: Record<string, string>, cookieHeader: string): Request {
  const cookieValue = cookieHeader.split(';')[0];
  return new Request(`${ORIGIN}/id/login`, {
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

// ─── Guard tests ─────────────────────────────────────────────────────────────

describe('login action — email-link guard when delivery is off', () => {
  it('returns 400 INVALID_INPUT when AUTH_EMAIL_DELIVERY_ENABLED=false and intent=email-link', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, intent: 'email-link', loginName: 'email-otp-user@acme.test' },
      cookie
    );
    const res = await runAction(req);

    expect(statusOf(res)).toBe(400);
    expect((await bodyOf(res))?.error).toBe('INVALID_INPUT');
  });

  it('does not redirect to /login/verify/email when delivery is off', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest(
      { csrf: token, intent: 'email-link', loginName: 'email-otp-user@acme.test' },
      cookie
    );
    const res = await runAction(req);

    // Must be a data response with error, not a redirect
    if (res instanceof Response) {
      expect(res.status).not.toBe(302);
    }
    expect((await bodyOf(res))?.error).toBe('INVALID_INPUT');
  });
});
