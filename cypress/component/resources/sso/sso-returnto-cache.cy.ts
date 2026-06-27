// cypress/component/resources/sso/sso-returnto-cache.cy.ts
//
// Component (no-mount) port of the BROWSER-SAFE half of
// app/resources/sso/__tests__/sso-perf-returnto.test.ts:
//   • requestScopedProviderReads — request-scoped memoization (no cross-request bleed). Uses a
//     real FakeAuthProvider + a no-cookie Request (browser-legal), with cy.spy counting calls.
//   • safeSameOriginReturnTo — the /sso/link open-redirect guard (pure string logic, SECURITY).
// The processIdpCallback getUser-drop cases from that file are node-bound → sso-callback.cy.ts.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { requestScopedProviderReads } from '@/resources/sso/idp-session';
import { safeSameOriginReturnTo } from '@/resources/sso/sso-link';

describe('requestScopedProviderReads — strictly per-request memoization', () => {
  it('issues one underlying call when the same lookup is requested twice in one request', () => {
    const provider = new FakeAuthProvider({
      users: [{ id: 'u9', loginName: 'cached@idp.test', displayName: 'Cached User' }],
    });
    const getUserSpy = cy.spy(provider, 'getUser');

    const request = new Request('https://auth.localtest.me/sso/google/callback?id=i1&token=t1');
    const reads = requestScopedProviderReads(provider, request);

    return Promise.all([reads.getUser('u9'), reads.getUser('u9')]).then(([a, b]) => {
      expect(a).to.deep.equal(b);
      expect(a?.loginName).to.equal('cached@idp.test');
      expect(getUserSpy).to.have.callCount(1); // memoized within the request
    });
  });

  it('does NOT bleed across requests — a fresh Request re-issues the call', () => {
    const provider = new FakeAuthProvider({
      users: [{ id: 'u9', loginName: 'cached@idp.test', displayName: 'Cached User' }],
    });
    const getUserSpy = cy.spy(provider, 'getUser');

    const req1 = new Request('https://auth.localtest.me/sso/google/callback?id=i1&token=t1');
    const req2 = new Request('https://auth.localtest.me/sso/google/callback?id=i2&token=t2');

    return requestScopedProviderReads(provider, req1)
      .getUser('u9')
      .then(() => requestScopedProviderReads(provider, req2).getUser('u9'))
      .then(() => {
        // strictly request-scoped: each distinct Request gets its own cache → two calls.
        expect(getUserSpy).to.have.callCount(2);
      });
  });

  it('distinguishes cache keys by argument (different userId → separate call)', () => {
    const provider = new FakeAuthProvider({
      users: [
        { id: 'u1', loginName: 'a@idp.test' },
        { id: 'u2', loginName: 'b@idp.test' },
      ],
    });
    const getUserSpy = cy.spy(provider, 'getUser');
    const request = new Request('https://auth.localtest.me/sso/google/callback?id=i1&token=t1');
    const reads = requestScopedProviderReads(provider, request);

    return reads
      .getUser('u1')
      .then(() => reads.getUser('u2'))
      .then(() => reads.getUser('u1'))
      .then(() => {
        expect(getUserSpy).to.have.callCount(2); // u1 cached, u2 distinct
      });
  });
});

describe('safeSameOriginReturnTo — same-origin allowlist (open-redirect guard)', () => {
  const ORIGIN = 'https://auth.localtest.me';

  it('accepts a same-origin relative path verbatim', () => {
    expect(safeSameOriginReturnTo('/sso/link?provider=google', ORIGIN)).to.equal(
      '/sso/link?provider=google'
    );
  });

  it('accepts a same-origin absolute URL and returns its path+search', () => {
    expect(safeSameOriginReturnTo('https://auth.localtest.me/sso/link?x=1', ORIGIN)).to.equal(
      '/sso/link?x=1'
    );
  });

  it('rejects a cross-origin absolute URL → safe default', () => {
    expect(safeSameOriginReturnTo('https://evil.example/steal', ORIGIN)).to.equal('/');
  });

  it('rejects a protocol-relative URL (//evil.com) → safe default', () => {
    expect(safeSameOriginReturnTo('//evil.example/steal', ORIGIN)).to.equal('/');
  });

  it('rejects a javascript: scheme → safe default', () => {
    expect(safeSameOriginReturnTo('javascript:alert(1)', ORIGIN)).to.equal('/');
  });

  it('rejects a backslash-obfuscated authority (/\\evil.com) → safe default', () => {
    expect(safeSameOriginReturnTo('/\\evil.example', ORIGIN)).to.equal('/');
  });

  it('falls back to the safe default for empty/undefined input', () => {
    expect(safeSameOriginReturnTo('', ORIGIN)).to.equal('/');
    expect(safeSameOriginReturnTo(undefined, ORIGIN)).to.equal('/');
  });
});
