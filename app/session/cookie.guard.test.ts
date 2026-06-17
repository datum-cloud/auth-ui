// app/session/cookie.guard.test.ts
// @vitest-environment node
//
// P7 Task 8 Step 8 (P0 carry-over): readSessions zod guard.
// Must run in the node environment — happy-dom forbids setting the `cookie`
// header on a Request (same reasoning as app/routes/device.test.ts), and these
// tests exercise readSessions(request) end-to-end with real cookie headers.
import { readSessions, serializeSessions } from './cookie';
import type { SessionEntry } from './session';
import { createCookie } from 'react-router';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const entry: SessionEntry = {
  id: 's1',
  token: 't1',
  loginName: 'a@acme.test',
  creationTs: '2026-01-01T00:00:00.000Z',
  expirationTs: '2099-01-01T00:00:00.000Z',
  changeTs: '2026-01-01T00:00:00.000Z',
};

function reqWithCookie(cookieHeader?: string): Request {
  return new Request('http://localhost/id/accounts', {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

function setCookieToHeader(setCookie: string): string {
  return setCookie.split(';')[0].trim();
}

describe('readSessions zod guard (P0 carry-over)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // readSessions audits through logAuthEvent's default console.log sink.
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  function auditLines(): string[] {
    return logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((l: string) => l.includes('session_cookie'));
  }

  it('valid signed entries round-trip unchanged', async () => {
    const header = setCookieToHeader(await serializeSessions([entry]));
    const result = await readSessions(reqWithCookie(header));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
    expect(auditLines()).toHaveLength(0);
  });

  it('absent cookie header → [] with NO audit signal', async () => {
    const result = await readSessions(reqWithCookie());
    expect(result).toEqual([]);
    expect(auditLines()).toHaveLength(0);
  });

  it('tampered signature → [] + invalid_signature audit', async () => {
    const header = setCookieToHeader(await serializeSessions([entry]));
    // flip characters mid-value to break the HMAC
    const eq = header.indexOf('=');
    const tampered = header.slice(0, eq + 6) + 'XXXXX' + header.slice(eq + 11);
    const result = await readSessions(reqWithCookie(tampered));
    expect(result).toEqual([]);
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('invalid_signature');
  });

  it('validly-signed wrong-shape payload → [] + malformed_payload audit', async () => {
    // sign garbage with the SAME secret via an independent cookie instance
    const forger = createCookie('sessions', {
      secrets: [process.env.SESSION_SECRET ?? ''],
      path: '/',
    });
    const garbage = setCookieToHeader(await forger.serialize([{ bogus: true }]));
    const result = await readSessions(reqWithCookie(garbage));
    expect(result).toEqual([]);
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('malformed_payload');
  });

  it('validly-signed non-array payload → [] + malformed_payload audit', async () => {
    const forger = createCookie('sessions', {
      secrets: [process.env.SESSION_SECRET ?? ''],
      path: '/',
    });
    const garbage = setCookieToHeader(await forger.serialize({ not: 'an array' }));
    const result = await readSessions(reqWithCookie(garbage));
    expect(result).toEqual([]);
    expect(auditLines()).toHaveLength(1);
  });
});
