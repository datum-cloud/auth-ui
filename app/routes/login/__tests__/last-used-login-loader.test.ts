// @vitest-environment node
//
// TDD: verify that the /login loader threads lastUsedLogin from the
// last-used-login cookie into its returned data object.
//
// node env: happy-dom forbids setting the Cookie header (breaks CSRF round-trips).
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { loader } from '@/routes/login/index';
import { describe, it, expect } from 'vitest';

const ORIGIN = 'http://localhost';

function loaderArgs(url: string, cookieHeader?: string) {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers['cookie'] = cookieHeader;
  return {
    request: new Request(url, { headers }),
    params: {},
    context: {} as never,
  } as never;
}

async function cookieValueOf(serialized: string): Promise<string> {
  // Strip attributes; keep only the name=value part for the Cookie header.
  return serialized.split(';')[0];
}

/** The loader returns a DataWithResponseInit envelope; unwrap .data to reach the payload. */
function dataOf(res: unknown): { lastUsedLogin?: string | null } | null {
  return (res as { data?: { lastUsedLogin?: string | null } }).data ?? null;
}

describe('/login loader — lastUsedLogin threading', () => {
  it('returns lastUsedLogin=null when the cookie is absent', async () => {
    const res = await loader(loaderArgs(`${ORIGIN}/id/login`));
    // Should not be a redirect (no authRequest/samlRequest in URL)
    expect(res).not.toBeInstanceOf(Response);
    const d = dataOf(res);
    expect(d).not.toBeNull();
    expect(d!.lastUsedLogin).toBeNull();
  });

  it('returns lastUsedLogin="email" when the cookie contains "email"', async () => {
    const serialized = await serializeLastUsedLogin('email');
    const cookieHeader = await cookieValueOf(serialized);
    const res = await loader(loaderArgs(`${ORIGIN}/id/login`, cookieHeader));
    expect(res).not.toBeInstanceOf(Response);
    expect(dataOf(res)!.lastUsedLogin).toBe('email');
  });

  it('returns lastUsedLogin="passkey" when the cookie contains "passkey"', async () => {
    const serialized = await serializeLastUsedLogin('passkey');
    const cookieHeader = await cookieValueOf(serialized);
    const res = await loader(loaderArgs(`${ORIGIN}/id/login`, cookieHeader));
    expect(res).not.toBeInstanceOf(Response);
    expect(dataOf(res)!.lastUsedLogin).toBe('passkey');
  });

  it('returns lastUsedLogin="idp:google" when the cookie contains "idp:google"', async () => {
    const serialized = await serializeLastUsedLogin('idp:google');
    const cookieHeader = await cookieValueOf(serialized);
    const res = await loader(loaderArgs(`${ORIGIN}/id/login`, cookieHeader));
    expect(res).not.toBeInstanceOf(Response);
    expect(dataOf(res)!.lastUsedLogin).toBe('idp:google');
  });
});
