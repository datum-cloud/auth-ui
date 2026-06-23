// Task 4 route-level guard: the /login identifier action must STRICT-REJECT phone-format
// input (distinct PHONE_LOGIN_DISABLED error, HTTP 400) — but ONLY when the org's login
// settings disable phone login (disableLoginWithPhone). With the flag off/absent (today's
// default) a phone-shaped loginName flows through the normal resolveIdentifier path
// unchanged, proving the behavior-preserving invariant.
//
// The phone-format detection (isPhoneLike) and the email-leniency are unit-tested at the
// schema level (app/resources/login/__tests__/login-schema.test.ts). THIS file is the
// irreplaceable route-level guard that the action actually wires the policy → rejection.
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
const PHONE_INPUT = '+15550000000';

/** Mint a CSRF token+cookie pair against the login route URL. */
async function mintCsrf() {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}/id/login`));
  return { token, cookie: cookie! };
}

/** Build a POST Request for the login identifier action. */
function identifierPostRequest(fields: Record<string, string>, cookieHeader: string): Request {
  const cookieValue = cookieHeader.split(';')[0];
  const body = new URLSearchParams(fields);
  return new Request(`${ORIGIN}/id/login`, {
    method: 'POST',
    headers: {
      cookie: cookieValue,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
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

async function bodyOf(res: unknown): Promise<{ error?: string } | null> {
  if (res instanceof Response) {
    try {
      return (await res.json()) as { error?: string };
    } catch {
      return null;
    }
  }
  // react-router data() returns a serializable wrapper in tests.
  const data = (res as { data?: { error?: string } }).data;
  return data ?? null;
}

function statusOf(res: unknown): number | undefined {
  if (res instanceof Response) return res.status;
  return (res as { init?: { status?: number } }).init?.status;
}

describe('login action — strict phone rejection per disableLoginWithPhone policy', () => {
  it('rejects phone-format loginName with PHONE_LOGIN_DISABLED when org disables phone login', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    const spy = vi.spyOn(fake, 'getLoginSettings').mockResolvedValue({
      disableLoginWithPhone: true,
    } as unknown as LoginSettings);

    const { token, cookie } = await mintCsrf();
    const req = identifierPostRequest(
      { csrf: token, loginName: PHONE_INPUT, organization: 'phone-disabled-org' },
      cookie
    );

    const res = await runAction(req);

    expect(statusOf(res)).toBe(400);
    expect((await bodyOf(res))?.error).toBe('PHONE_LOGIN_DISABLED');
    spy.mockRestore();
  });

  it('does NOT phone-reject when phone login is enabled (default-off ⇒ today behavior)', async () => {
    const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
    // Default settings — disableLoginWithPhone is false/absent.
    const spy = vi.spyOn(fake, 'getLoginSettings');

    const { token, cookie } = await mintCsrf();
    const req = identifierPostRequest({ csrf: token, loginName: PHONE_INPUT }, cookie);

    const res = await runAction(req);

    // Phone check is bypassed → the input flows to resolveIdentifier, which fails to find a
    // matching account (USER_NOT_FOUND, a 200 inline error — F1) rather than the phone-disabled error.
    const error = (await bodyOf(res))?.error;
    expect(error).not.toBe('PHONE_LOGIN_DISABLED');
    spy.mockRestore();
  });
});
