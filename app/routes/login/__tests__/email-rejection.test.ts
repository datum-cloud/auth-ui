// Task 3 route-level guard: the /login identifier action must return EMAIL_LOGIN_DISABLED (HTTP 400)
// when the org's login settings disable email login AND the input is email-shaped (unknown user).
// With the flag off/absent (today's default) an email-shaped loginName flows through the normal
// resolveIdentifier path unchanged, proving the behavior-preserving invariant.
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

const ORIGIN = 'http://localhost';
const EMAIL_INPUT = 'ghost@acme.test'; // email-shaped, not a real user → lookup fails

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

describe('login action — EMAIL_LOGIN_DISABLED when org disables email login', () => {
  it('email-shaped unknown identifier → EMAIL_LOGIN_DISABLED (400)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi
      .spyOn(fake, 'getLoginSettings')
      .mockResolvedValue({ disableLoginWithEmail: true } as unknown as LoginSettings);

    const { token, cookie } = await mintCsrf();
    const req = identifierPostRequest(
      { csrf: token, loginName: EMAIL_INPUT, organization: 'email-disabled-org' },
      cookie
    );

    const res = await runAction(req);

    expect(statusOf(res)).toBe(400);
    expect((await bodyOf(res))?.error).toBe('EMAIL_LOGIN_DISABLED');
    spy.mockRestore();
  });

  it('does NOT email-reject when email login is enabled (default-off ⇒ today behavior)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'getLoginSettings'); // real defaults: disableLoginWithEmail false

    const { token, cookie } = await mintCsrf();
    const req = identifierPostRequest({ csrf: token, loginName: EMAIL_INPUT }, cookie);

    const res = await runAction(req);

    const error = (await bodyOf(res))?.error;
    expect(error).not.toBe('EMAIL_LOGIN_DISABLED'); // flows to USER_NOT_FOUND
    spy.mockRestore();
  });
});
