// SSO request-scoped RPC cache + sso/link returnTo allowlist.
// @vitest-environment node
//
// node env: happy-dom forbids setting the `Cookie` header on a Request (Fetch spec). The
// SSO services are driven directly here. Two concerns:
//
//   • Performance (behavior-preserving): within ONE processIdpCallback request, the redundant
//     post-create `getUser` lookup is dropped (idpUserName suffices) and overlapping
//     read-only RPCs are memoized request-scoped — fewer calls, identical observable output.
//     The request-scoped cache is strictly per-Request (never cross-request).
//   • `safeSameOriginReturnTo` rejects a cross-origin / protocol-relative returnTo and
//     accepts a same-origin relative path, closing the open-redirect on /sso/link.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import type { IdpIntentResult } from '@/modules/auth/types';
import {
  processIdpCallback,
  safeSameOriginReturnTo,
  requestScopedProviderReads,
} from '@/resources/sso';
import { describe, it, expect, vi } from 'vitest';

// ── Redundant getUser dropped on the sign-in path ────────────────────────

describe('processIdpCallback — redundant getUser dropped (sign-in path)', () => {
  it('does not call getUser on the sign-in path (idpUserName suffices) — identical redirect', async () => {
    const provider = new FakeAuthProvider({
      users: [{ id: 'u-signin', loginName: 'linked@idp.test', displayName: 'Linked User' }],
    });
    const getUserSpy = vi.spyOn(provider, 'getUser');

    const SIGN_IN_INTENT: IdpIntentResult = {
      userId: 'u-signin',
      information: { idpId: 'idp-g', idpUserId: 'g-linked', idpUserName: 'linked@idp.test' },
      draft: null,
    };

    const request = new Request('https://auth.localtest.me/sso/google/callback?id=i1&token=t1');
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => SIGN_IN_INTENT,
      onAuthEvent: () => {},
    });

    expect(outcome.kind).toBe('redirect');
    // Sign-in path used to issue getUser(userId) purely to read loginName; idpUserName
    // already carries it, so the lookup is now elided.
    expect(getUserSpy).not.toHaveBeenCalled();
  });
});

// ── Redundant getUser dropped on the auto-link path ───────────────────────

describe('processIdpCallback — redundant getUser dropped (auto-link path)', () => {
  it('does not call getUser on the auto-link path — identical redirect + cookie', async () => {
    const provider = new FakeAuthProvider({
      users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
      // no password seeded → auto-link decision
    });
    const getUserSpy = vi.spyOn(provider, 'getUser');

    const AUTOLINK_INTENT: IdpIntentResult = {
      userId: null,
      information: { idpId: 'idp-g', idpUserId: 'g-al', idpUserName: 'you@gmail.com' },
      draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
    };

    const request = new Request('https://auth.localtest.me/sso/google/callback?id=i1&token=t1');
    const outcome = await processIdpCallback(provider, request, 'google', {
      retrieveIdpIntent: async () => AUTOLINK_INTENT,
      onAuthEvent: () => {},
    });

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind === 'redirect') {
      expect(outcome.setCookie).toBeTruthy();
    }
    expect(getUserSpy).not.toHaveBeenCalled();
  });
});

// ── Request-scoped cache memoizes overlapping reads once-per-request ───────

describe('requestScopedProviderReads — strictly per-request memoization', () => {
  it('issues one underlying call when the same lookup is requested twice in one request', async () => {
    const provider = new FakeAuthProvider({
      users: [{ id: 'u9', loginName: 'cached@idp.test', displayName: 'Cached User' }],
    });
    const getUserSpy = vi.spyOn(provider, 'getUser');

    const request = new Request('https://auth.localtest.me/sso/google/callback?id=i1&token=t1');
    const reads = requestScopedProviderReads(provider, request);

    const a = await reads.getUser('u9');
    const b = await reads.getUser('u9');

    expect(a).toEqual(b);
    expect(a?.loginName).toBe('cached@idp.test');
    expect(getUserSpy).toHaveBeenCalledTimes(1); // memoized within the request
  });

  it('does NOT bleed across requests — a fresh Request re-issues the call', async () => {
    const provider = new FakeAuthProvider({
      users: [{ id: 'u9', loginName: 'cached@idp.test', displayName: 'Cached User' }],
    });
    const getUserSpy = vi.spyOn(provider, 'getUser');

    const req1 = new Request('https://auth.localtest.me/sso/google/callback?id=i1&token=t1');
    const req2 = new Request('https://auth.localtest.me/sso/google/callback?id=i2&token=t2');

    await requestScopedProviderReads(provider, req1).getUser('u9');
    await requestScopedProviderReads(provider, req2).getUser('u9');

    // strictly request-scoped: each distinct Request gets its own cache → two calls.
    expect(getUserSpy).toHaveBeenCalledTimes(2);
  });

  it('distinguishes cache keys by argument (different userId → separate call)', async () => {
    const provider = new FakeAuthProvider({
      users: [
        { id: 'u1', loginName: 'a@idp.test' },
        { id: 'u2', loginName: 'b@idp.test' },
      ],
    });
    const getUserSpy = vi.spyOn(provider, 'getUser');
    const request = new Request('https://auth.localtest.me/sso/google/callback?id=i1&token=t1');
    const reads = requestScopedProviderReads(provider, request);

    await reads.getUser('u1');
    await reads.getUser('u2');
    await reads.getUser('u1');

    expect(getUserSpy).toHaveBeenCalledTimes(2); // u1 cached, u2 distinct
  });
});

// ── returnTo same-origin allowlist ──────────────────────────────────────────

describe('safeSameOriginReturnTo — same-origin allowlist', () => {
  const ORIGIN = 'https://auth.localtest.me';

  it('accepts a same-origin relative path verbatim', () => {
    expect(safeSameOriginReturnTo('/sso/link?provider=google', ORIGIN)).toBe(
      '/sso/link?provider=google'
    );
  });

  it('accepts a same-origin absolute URL and returns its path+search', () => {
    expect(safeSameOriginReturnTo('https://auth.localtest.me/sso/link?x=1', ORIGIN)).toBe(
      '/sso/link?x=1'
    );
  });

  it('rejects a cross-origin absolute URL → safe default', () => {
    expect(safeSameOriginReturnTo('https://evil.example/steal', ORIGIN)).toBe('/');
  });

  it('rejects a protocol-relative URL (//evil.com) → safe default', () => {
    expect(safeSameOriginReturnTo('//evil.example/steal', ORIGIN)).toBe('/');
  });

  it('rejects a javascript: scheme → safe default', () => {
    expect(safeSameOriginReturnTo('javascript:alert(1)', ORIGIN)).toBe('/');
  });

  it('rejects a backslash-obfuscated authority (/\\evil.com) → safe default', () => {
    expect(safeSameOriginReturnTo('/\\evil.example', ORIGIN)).toBe('/');
  });

  it('falls back to the safe default for empty/undefined input', () => {
    expect(safeSameOriginReturnTo('', ORIGIN)).toBe('/');
    expect(safeSameOriginReturnTo(undefined, ORIGIN)).toBe('/');
  });
});
