// @vitest-environment node
//
// The reauth-intent cookie + the SHARED re-auth identity guard used by every login factor
// (password, IdP callback, passkey/security-key). checkReauthIntent is the single source of the
// match/mismatch decision, so testing it here covers the guard logic for all factors at once.
import {
  serializeReauthIntent,
  readReauthIntent,
  clearReauthIntent,
  checkReauthIntent,
} from '../reauth-intent';
import { describe, it, expect } from 'vitest';

/** A request carrying ONLY the reauth-intent cookie (or none when intent is null). */
async function req(intent: string | null): Promise<Request> {
  const headers: Record<string, string> = {};
  if (intent !== null) headers.cookie = (await serializeReauthIntent(intent)).split(';')[0];
  return new Request('http://localhost/id/login/password', { headers });
}

describe('reauth-intent cookie round-trip', () => {
  it('serialize → read returns the stored loginName', async () => {
    expect(await readReauthIntent(await req('alice@acme.test'))).toBe('alice@acme.test');
  });

  it('read returns null when the cookie is absent', async () => {
    expect(await readReauthIntent(await req(null))).toBeNull();
  });

  it('clear produces an immediately-expiring Set-Cookie', async () => {
    const cleared = await clearReauthIntent();
    expect(cleared).toContain('reauth-intent=');
    expect(cleared).toMatch(/Max-Age=0/i);
  });
});

describe('checkReauthIntent (shared identity guard)', () => {
  it('no intent in flight → not a re-auth, no mismatch, no clear cookie', async () => {
    const r = await checkReauthIntent(await req(null), 'whoever@acme.test');
    expect(r).toEqual({ intent: null, mismatch: false });
  });

  it('matching identity → no mismatch, intent echoed, clear cookie present', async () => {
    const r = await checkReauthIntent(await req('alice@acme.test'), 'alice@acme.test');
    expect(r.intent).toBe('alice@acme.test');
    expect(r.mismatch).toBe(false);
    expect(r.clearCookie).toContain('reauth-intent=');
  });

  it('matches case-insensitively (IdP/SAML may return different casing)', async () => {
    const r = await checkReauthIntent(await req('Alice@ACME.test'), 'alice@acme.test');
    expect(r.mismatch).toBe(false);
  });

  it('different identity → mismatch true, clear cookie still present', async () => {
    const r = await checkReauthIntent(await req('alice@acme.test'), 'bob@acme.test');
    expect(r.intent).toBe('alice@acme.test');
    expect(r.mismatch).toBe(true);
    expect(r.clearCookie).toContain('reauth-intent=');
  });
});
