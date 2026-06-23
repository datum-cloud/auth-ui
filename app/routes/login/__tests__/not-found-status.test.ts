// F1: an unknown identifier is a HANDLED, inline-rendered outcome. The /login identifier action
// must return USER_NOT_FOUND as NORMAL action data with a 200 status — NOT a 404 — so the React
// Router single-fetch (/login.data?index) does not surface a 404 the browser console-errors on.
// The inline <FormError> still renders from `data.error`. EMAIL_LOGIN_DISABLED stays a 400 (a true
// client-input rejection), proving the not-found relaxation is scoped to the not-found case only.
//
// @vitest-environment node
//
// node env: happy-dom enforces Fetch spec rules that forbid setting the Cookie header,
// which breaks the CSRF round-trip used here.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import type { LoginSettings } from '@/modules/auth/types';
import { action } from '@/routes/login/index';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// env stub — email delivery ON, so the intent=email-link not-found path is reachable here.
// (vi.stubEnv can't help: the env singleton is parsed/frozen at import time.) The default
// identifier-branch behavior under test is independent of this flag.
vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, AUTH_EMAIL_DELIVERY_ENABLED: true },
  };
});

const ORIGIN = 'http://localhost';
const UNKNOWN_IDENTIFIER = 'nobody-here@acme.test'; // not a seeded fake user → findUser null

async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/id/login`));
  return { token, cookie: cookie! };
}

function identifierPostRequest(fields: Record<string, string>, cookieHeader: string): Request {
  const cookieValue = cookieHeader.split(';')[0];
  return new Request(`${ORIGIN}/id/login`, {
    method: 'POST',
    headers: { cookie: cookieValue, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

async function runAction(req: Request) {
  return action({
    request: req,
    params: {},
    context: {} as never,
    url: new URL(req.url),
    pattern: '',
  } as never);
}

// data() returns a DataWithResponseInit whose status lives on `.init.status`; an UNSET status
// (the 200 default) means `init` is null or `init.status` is undefined. A Response carries
// `.status` directly. Normalize to the effective HTTP status (200 when unset).
function statusOf(res: unknown): number {
  if (res instanceof Response) return res.status;
  return (res as { init?: { status?: number } }).init?.status ?? 200;
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

describe('login action — USER_NOT_FOUND is a 200 inline error, not a 404 (F1)', () => {
  it('unknown identifier → USER_NOT_FOUND with HTTP 200 (no console-erroring 404)', async () => {
    getAuthProvider({ AUTH_PROVIDER: 'fake' }); // ensure fake singleton is selected

    const { token, cookie } = await mintCsrf();
    const req = identifierPostRequest({ csrf: token, loginName: UNKNOWN_IDENTIFIER }, cookie);

    const res = await runAction(req);

    expect((await bodyOf(res))?.error).toBe('USER_NOT_FOUND');
    expect(statusOf(res)).toBe(200);
  });

  it('email-link branch: unknown identifier → USER_NOT_FOUND with HTTP 200', async () => {
    // The email-link branch is only reachable when email delivery is enabled (mocked ON at the
    // top of this file). Behavior is identical to the identifier branch: not-found → 200.
    const { token, cookie } = await mintCsrf();
    const req = identifierPostRequest(
      { csrf: token, loginName: UNKNOWN_IDENTIFIER, intent: 'email-link' },
      cookie
    );

    const res = await runAction(req);

    expect((await bodyOf(res))?.error).toBe('USER_NOT_FOUND');
    expect(statusOf(res)).toBe(200);
  });

  it('EMAIL_LOGIN_DISABLED stays a 400 (not-found relaxation is scoped to the not-found case)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi
      .spyOn(fake, 'getLoginSettings')
      .mockResolvedValue({ disableLoginWithEmail: true } as unknown as LoginSettings);

    const { token, cookie } = await mintCsrf();
    const req = identifierPostRequest(
      { csrf: token, loginName: UNKNOWN_IDENTIFIER, organization: 'email-disabled-org' },
      cookie
    );

    const res = await runAction(req);

    expect((await bodyOf(res))?.error).toBe('EMAIL_LOGIN_DISABLED');
    expect(statusOf(res)).toBe(400);
    spy.mockRestore();
  });
});
