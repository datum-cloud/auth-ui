import { serializeSessions, sessionsCookie } from '@/modules/auth/session/cookie';
import type { SessionEntry } from '@/modules/auth/session/session';
import { createCookie } from 'react-router';
import { describe, it, expect } from 'vitest';

const base: SessionEntry = {
  id: 's1',
  token: 't1',
  loginName: 'a@acme.test',
  creationTs: '1000',
  expirationTs: '9999999999999',
  changeTs: '1000',
};

function makeEntry(id: string, changeTs: string, loginName = 'a@acme.test'): SessionEntry {
  return { ...base, id, token: `tok-${id}`, loginName, changeTs };
}

/**
 * Extract the raw `name=value` pair from a Set-Cookie header string so it can be
 * passed directly to `sessionsCookie.parse()` as a Cookie request header.
 * (happy-dom blocks `cookie` as a forbidden header on `new Request()`, so we parse
 * via `sessionsCookie.parse(cookieHeader)` directly instead of via `readSessions`.)
 */
function setCookieToCookieHeader(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0].trim();
}

describe('cookie layer', () => {
  it('round-trips a session list through serialize → parse', async () => {
    const list = [makeEntry('s1', '100'), makeEntry('s2', '200')];
    const setCookieValue = await serializeSessions(list);
    const cookieHeader = setCookieToCookieHeader(setCookieValue);
    const parsed = (await sessionsCookie.parse(cookieHeader)) ?? [];
    expect(parsed).toHaveLength(2);
    expect(parsed.map((s: SessionEntry) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('returns [] for a tampered cookie value (invalid signature)', async () => {
    const list = [makeEntry('s1', '100')];
    const setCookieValue = await serializeSessions(list);
    const cookieHeader = setCookieToCookieHeader(setCookieValue);
    // Corrupt the signed payload by flipping a character mid-value
    const parts = cookieHeader.split('=');
    const tampered =
      parts[0] +
      '=' +
      parts
        .slice(1)
        .join('=')
        .replace(/^(.....)/, (m) => m.split('').reverse().join(''));
    const result = await sessionsCookie.parse(tampered);
    // A tampered signature must parse to null (react-router returns null on bad sig)
    expect(result ?? []).toEqual([]);
  });

  it('overflow: serialized value ≤ 2048 bytes and only newest entries survive', async () => {
    // 10 entries with ~160-char loginNames and ascending changeTs
    const longName = 'a'.repeat(150) + '@acme.test';
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`s${i + 1}`, String((i + 1) * 100), longName)
    );
    const setCookieValue = await serializeSessions(entries);
    const bytes = new TextEncoder().encode(setCookieValue).byteLength;
    expect(bytes).toBeLessThanOrEqual(2048);

    // Parse back and verify only the newest entries (highest changeTs) survived
    const cookieHeader = setCookieToCookieHeader(setCookieValue);
    const parsed: SessionEntry[] = (await sessionsCookie.parse(cookieHeader)) ?? [];
    // Newest by changeTs should be survivors
    const byNewest = [...entries].sort((a, b) => Number(b.changeTs) - Number(a.changeTs));
    const expectedIds = byNewest
      .slice(0, parsed.length)
      .map((e) => e.id)
      .sort();
    expect(parsed.map((s) => s.id).sort()).toEqual(expectedIds);
    // Must have evicted at least something (the long names should overflow 2048 for 10 entries)
    expect(parsed.length).toBeLessThan(10);
  });

  it('single entry whose serialized size alone exceeds 2048 bytes parses back to []', async () => {
    // loginName padded to ~2000 chars so the signed cookie will exceed 2048 bytes
    const giantEntry = makeEntry('s-giant', '999', 'x'.repeat(2000) + '@example.com');
    const setCookieValue = await serializeSessions([giantEntry]);
    // The result must be a signed empty array (not an oversized cookie)
    const bytes = new TextEncoder().encode(setCookieValue).byteLength;
    expect(bytes).toBeLessThanOrEqual(2048);
    const cookieHeader = setCookieToCookieHeader(setCookieValue);
    const parsed: SessionEntry[] = (await sessionsCookie.parse(cookieHeader)) ?? [];
    expect(parsed).toEqual([]);
  });

  it('cross-replica: cookie signed by replica-A parses correctly on replica-B (same shared secret)', async () => {
    // Simulates HA: two Kubernetes pods each independently construct their own
    // createCookie instance at boot time with the same SESSION_SECRET.  A request
    // whose Set-Cookie was written by replica A must be readable on replica B.
    // This test uses two genuinely separate instances — not a reference to the
    // module-level sessionsCookie singleton — to prove the HMAC verification is
    // purely secret-keyed and not instance-keyed.
    const SHARED_SECRET = 'test-secret-test-secret-32-chars!!';

    // Replica A: constructs its own cookie instance and serializes the session list.
    const replicaA = createCookie('sessions', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secrets: [SHARED_SECRET],
    });
    const entry = makeEntry('x1', '500');
    const setCookieValue = await replicaA.serialize([entry]);
    const cookieHeader = setCookieToCookieHeader(setCookieValue);

    // Replica B: a completely independent createCookie call with the same secret.
    const replicaB = createCookie('sessions', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secrets: [SHARED_SECRET],
    });
    const parsed: SessionEntry[] = (await replicaB.parse(cookieHeader)) ?? [];

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('x1');
  });
});
