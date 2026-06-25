// @vitest-environment node
//
// Re-auth identity guard on the IdP callback path. When a sign-in is started to RE-AUTHENTICATE a
// specific account (the `reauth-intent` cookie carries that loginName), signInWithIdpIntent must
// verify the account that ACTUALLY authenticated (the IdP-vouched fallbackLoginName) matches it:
//   • no intent          → normal /authorize hand-back, no clear cookie
//   • intent matches      → continue the ceremony (hand-back) + clear the intent marker
//   • intent MISMATCHES   → do NOT continue as the wrong identity: bounce to /accounts
//                           (reauthMismatch), keep both accounts, clear the intent marker
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { serializeReauthIntent } from '@/modules/auth/session/reauth-intent';
import { signInWithIdpIntent } from '@/resources/sso/idp-session';
import { describe, it, expect } from 'vitest';

/** A callback request carrying ONLY the reauth-intent cookie (null ⇒ no re-auth in flight). */
async function reqWithReauth(intent: string | null): Promise<Request> {
  const headers: Record<string, string> = {};
  if (intent !== null) {
    const cookie = await serializeReauthIntent(intent);
    headers.cookie = cookie.split(';')[0];
  }
  return new Request('http://localhost/id/sso/google/callback', { headers });
}

function opts(fallbackLoginName: string, requestId = 'oidc_x') {
  return { idpIntentId: 'i1', idpIntentToken: 't1', userId: 'u1', fallbackLoginName, requestId };
}

describe('signInWithIdpIntent — re-auth identity guard', () => {
  it('no re-auth intent → normal /authorize hand-back, no clear cookie', async () => {
    const provider = new FakeAuthProvider({});
    const r = await signInWithIdpIntent(
      provider,
      await reqWithReauth(null),
      opts('alice@acme.test')
    );
    expect(r.target).toContain('/authorize');
    expect(r.target).toContain('requestId=oidc_x');
    expect(r.reauthClearCookie).toBeUndefined();
  });

  it('matching re-auth → continues the ceremony (hand-back) and clears the intent', async () => {
    const provider = new FakeAuthProvider({});
    const r = await signInWithIdpIntent(
      provider,
      await reqWithReauth('alice@acme.test'),
      opts('alice@acme.test')
    );
    expect(r.target).toContain('/authorize');
    expect(r.target).not.toContain('reauthMismatch');
    expect(r.reauthClearCookie).toBeTruthy();
    expect(r.reauthClearCookie).toContain('reauth-intent=');
  });

  it('matches case-insensitively (IdP may return a different casing than stored)', async () => {
    const provider = new FakeAuthProvider({});
    const r = await signInWithIdpIntent(
      provider,
      await reqWithReauth('Alice@ACME.test'),
      opts('alice@acme.test')
    );
    // Case-only difference is a MATCH, not a mismatch → continues the ceremony.
    expect(r.target).toContain('/authorize');
    expect(r.target).not.toContain('reauthMismatch');
  });

  it('mismatched re-auth → bounces to /accounts (reauthMismatch), keeps both, clears the intent', async () => {
    const provider = new FakeAuthProvider({});
    const r = await signInWithIdpIntent(
      provider,
      await reqWithReauth('alice@acme.test'),
      opts('bob@acme.test')
    );
    expect(r.target).toContain('/accounts');
    expect(r.target).toContain('reauthMismatch=1');
    expect(r.target).not.toContain('/authorize');
    // The live requestId rides along so the user can resume the ceremony from the picker.
    expect(r.target).toContain('requestId=oidc_x');
    expect(r.reauthClearCookie).toBeTruthy();
    // The just-authenticated account is still written to the cookie (both accounts kept).
    expect(r.setCookie).toContain('sessions=');
  });
});
