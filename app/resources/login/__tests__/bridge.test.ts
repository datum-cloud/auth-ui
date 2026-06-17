// app/resources/login/__tests__/bridge.test.ts
//
// Pass 2: migrated from routes/login/__tests__/bridge.test.ts. The original asserted
// the /login → /authorize protocol-bridge behavior at the loader boundary; here we
// assert the identical decision directly against the extracted service predicate.
//
// Bridge: Zitadel's login-v2 base URI lands the browser on /id/login?authRequest=…
// (or ?samlRequest=…). The loader must forward that raw protocol entry to the
// /authorize orchestrator; a plain /login (or the post-identifier ?requestId=
// return) must render normally and NOT redirect.
import { shouldBridgeToAuthorize } from '@/resources/login';
import { describe, it, expect } from 'vitest';

function params(search: string): URLSearchParams {
  return new URL(`http://localhost/id/login${search}`).searchParams;
}

describe('/login → /authorize protocol bridge', () => {
  it('bridges ?authRequest= (the caller forwards to /authorize, preserving the query)', () => {
    expect(shouldBridgeToAuthorize(params('?authRequest=V2_abc&organization=org1'))).toBe(true);
  });

  it('bridges ?samlRequest= (the caller forwards to /authorize)', () => {
    expect(shouldBridgeToAuthorize(params('?samlRequest=sr-1'))).toBe(true);
  });

  it('does NOT bridge a plain /login (renders the identifier screen)', () => {
    expect(shouldBridgeToAuthorize(params(''))).toBe(false);
  });

  it('does NOT re-trigger on the post-identifier ?requestId= return (no loop)', () => {
    expect(shouldBridgeToAuthorize(params('?requestId=oidc_V2_abc'))).toBe(false);
  });
});
