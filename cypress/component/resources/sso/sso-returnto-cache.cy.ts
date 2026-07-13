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
});
