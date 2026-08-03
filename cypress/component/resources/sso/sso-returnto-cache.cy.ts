// cypress/component/resources/sso/sso-returnto-cache.cy.ts
//
// Component (no-mount) port of the BROWSER-SAFE half of
// app/resources/sso/__tests__/sso-perf-returnto.test.ts:
//   • safeSameOriginReturnTo — the /sso/link open-redirect guard (pure string logic, SECURITY).
// The processIdpCallback getUser-drop cases from that file are node-bound → sso-callback.cy.ts.
import { safeSameOriginReturnTo } from '@/resources/sso/sso-link';

describe('safeSameOriginReturnTo — same-origin allowlist (open-redirect guard)', () => {
  const ORIGIN = 'https://auth.localtest.me';

  it('rejects a cross-origin absolute URL → safe default', () => {
    expect(safeSameOriginReturnTo('https://evil.example/steal', ORIGIN)).to.equal('/');
  });

  it('rejects a protocol-relative URL (//evil.com) → safe default', () => {
    expect(safeSameOriginReturnTo('//evil.example/steal', ORIGIN)).to.equal('/');
  });

  // The ACCEPT half. Without it, a guard that returned the safe default unconditionally
  // would pass every reject case above while silently breaking every legitimate return —
  // the tests would be green and the feature dead.
  const ACCEPTED: [label: string, candidate: string, expected: string][] = [
    ['a plain app-relative path', '/passkeys', '/passkeys'],
    ['a relative path with a query', '/setup/passkey?force=true', '/setup/passkey?force=true'],
    [
      // An absolute URL on the trusted origin is reduced to its path — callers redirect
      // relative, and this keeps the origin from being restated.
      'a same-origin absolute URL, reduced to path + query',
      `${ORIGIN}/passkeys?x=1`,
      '/passkeys?x=1',
    ],
    // The fragment never survives: the guard returns pathname + search only. Asserted so a
    // future change that starts echoing candidate-controlled hash text is caught here.
    ['a fragment is dropped', '/passkeys#tok', '/passkeys'],
  ];

  it('passes a legitimate same-origin path through unchanged, reducing an absolute same-origin URL to path + query and dropping any fragment', () => {
    for (const [label, candidate, expected] of ACCEPTED) {
      expect(safeSameOriginReturnTo(candidate, ORIGIN), label).to.equal(expected);
    }
  });

  it('falls back to the safe default when no candidate is supplied', () => {
    expect(safeSameOriginReturnTo(undefined, ORIGIN)).to.equal('/');
  });
});
