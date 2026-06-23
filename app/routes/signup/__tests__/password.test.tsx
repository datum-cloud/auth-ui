// @vitest-environment node
//
// signup/password — route loader + action tests (coverage lift).
//
// The render test (password.render.test.tsx) pins the shared-primitive adoption on the
// happy path. This file exercises the loader's URL-param branches and the action's
// result-kind fan-out (INVALID_INPUT / sent / sent-with-session / redirect / thrown
// error → actionError), which moved behind the shared primitives but which
// no test drove — every assertion checks the real HTTP shape the route returns.
//
// node env: happy-dom forbids setting the Cookie header, which breaks the CSRF
// round-trip the action requires (assertCsrf).
import { ProviderError } from '@/modules/auth/types';
import { action, loader } from '@/routes/signup/password';
import { getCsrfToken } from '@/server/csrf';
import { describe, it, expect, vi } from 'vitest';

// Point AUTH_PROVIDER at the fake and silence MaxMind.
vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return { ...actual, env: { ...actual.env, MAXMIND_ACCOUNT_ID: '' } };
});

// The route only parses + renders; the registration dispatch lives in the service.
// Stub it so each test deterministically drives one result kind through the action's
// branch fan-out. requireEmailVerification + trustedAppOrigin are real (the action
// threads their outputs into the call, asserted via the mock's recorded args).
const registerWithPassword = vi.fn();
vi.mock('@/resources/signup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/resources/signup')>();
  return { ...actual, registerWithPassword: (...args: unknown[]) => registerWithPassword(...args) };
});

const ORIGIN = 'http://localhost';

async function mintCsrf(path = '/signup/password') {
  const [token, cookie] = await getCsrfToken(new Request(`${ORIGIN}${path}`));
  return { token, cookie: cookie! };
}

function postRequest(fields: Record<string, string>, cookieHeader: string): Request {
  const cookieValue = cookieHeader.split(';')[0];
  return new Request(`${ORIGIN}/signup/password`, {
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
    request: new Request(`${ORIGIN}/signup/password${search}`),
    params: {},
    context: {} as never,
  } as never);
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
  return res instanceof Response ? res.headers.get('Location') : null;
}

/** Read a header from either a real Response or a RR data() init object. */
function headerOf(res: unknown, name: string): string | null {
  if (res instanceof Response) return res.headers.get(name);
  const init = (res as { init?: { headers?: Record<string, string> } }).init;
  return init?.headers?.[name] ?? null;
}

const VALID = {
  loginName: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  password: 'sup3rsecret',
  confirm: 'sup3rsecret',
};

// ─── Loader ────────────────────────────────────────────────────────────────────

describe('signup/password — loader', () => {
  it('defaults identity fields to empty/undefined when the URL carries no params', async () => {
    const body = await bodyOf(await runLoader());
    expect(body?.csrfToken).toBeTruthy();
    expect(body?.loginName).toBe('');
    expect(body?.firstName).toBe('');
    expect(body?.lastName).toBe('');
    // organization/requestId fall through to undefined (the `?? undefined` branch).
    expect(body?.organization).toBeUndefined();
    expect(body?.requestId).toBeUndefined();
  });

  it('reflects the handoff params (loginName/names/organization/requestId) when present', async () => {
    const search =
      '?loginName=jane@example.com&firstName=Jane&lastName=Doe&organization=acme&requestId=rq-9&deviceTrackingToken=mm-1';
    const body = await bodyOf(await runLoader(search));
    expect(body?.loginName).toBe('jane@example.com');
    expect(body?.firstName).toBe('Jane');
    expect(body?.lastName).toBe('Doe');
    expect(body?.organization).toBe('acme');
    expect(body?.requestId).toBe('rq-9');
    expect(body?.deviceTrackingToken).toBe('mm-1');
  });
});

// ─── Action ──────────────────────────────────────────────────────────────────

describe('signup/password — action', () => {
  it('returns INVALID_INPUT (400) when the password schema rejects (mismatched confirm)', async () => {
    const { token, cookie } = await mintCsrf();
    const req = postRequest({ csrf: token, ...VALID, confirm: 'different!' }, cookie);
    const res = await runAction(req);

    expect(statusOf(res)).toBe(400);
    expect((await bodyOf(res))?.error).toBe('INVALID_INPUT');
    // The service must NOT be dispatched when validation fails.
    expect(registerWithPassword).not.toHaveBeenCalled();
  });

  it('maps a "sent" result to genericCheckYourEmail (sent=true, 200)', async () => {
    registerWithPassword.mockResolvedValueOnce({ kind: 'sent', email: VALID.loginName });
    const { token, cookie } = await mintCsrf();
    const res = await runAction(postRequest({ csrf: token, ...VALID }, cookie));

    expect(statusOf(res)).toBe(200);
    const body = await bodyOf(res);
    expect(body?.sent).toBe(true);
    expect(body?.email).toBe(VALID.loginName);
    // The action threads the trusted origin (not the Host header) into the service —
    // the Host-header email-link-injection defense.
    expect(registerWithPassword).toHaveBeenCalledTimes(1);
    const callArgs = registerWithPassword.mock.calls[0][2] as { origin: string; email: string };
    expect(callArgs.origin).toBe(ORIGIN);
    expect(callArgs.email).toBe(VALID.loginName);
  });

  it('maps a "sent-with-session" result to a 200 with a session set-cookie', async () => {
    registerWithPassword.mockResolvedValueOnce({
      kind: 'sent-with-session',
      email: VALID.loginName,
      sessions: [],
    });
    const { token, cookie } = await mintCsrf();
    const res = await runAction(postRequest({ csrf: token, ...VALID }, cookie));

    expect(statusOf(res)).toBe(200);
    expect((await bodyOf(res))?.sent).toBe(true);
    expect(headerOf(res, 'set-cookie')).toBeTruthy();
  });

  it('maps a "redirect" result to a 302 to the service-chosen target with a set-cookie', async () => {
    registerWithPassword.mockResolvedValueOnce({
      kind: 'redirect',
      target: '/setup/passkey?x=1',
      sessions: [],
    });
    const { token, cookie } = await mintCsrf();
    const res = await runAction(postRequest({ csrf: token, ...VALID }, cookie));

    expect(statusOf(res)).toBe(302);
    expect(locationOf(res)).toBe('/setup/passkey?x=1');
    expect((res as Response).headers.get('set-cookie')).toBeTruthy();
  });

  it('routes a recognised ProviderError through actionError to a neutral error code', async () => {
    // A duplicate-account throw resolves to the stable ALREADY_EXISTS code (409) — the
    // route surfaces the CODE, never the raw provider message (tamper-proof error model).
    registerWithPassword.mockRejectedValueOnce(
      new ProviderError('ALREADY_EXISTS', 'user jane@example.com already registered')
    );
    const { token, cookie } = await mintCsrf();
    const res = await runAction(postRequest({ csrf: token, ...VALID }, cookie));

    expect(statusOf(res)).toBe(409);
    const body = await bodyOf(res);
    expect(body?.error).toBe('ALREADY_EXISTS');
    expect(body?.error).not.toContain('jane@example.com');
  });
});
