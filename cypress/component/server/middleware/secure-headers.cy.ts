// cypress/component/server/middleware/secure-headers.cy.ts
// COMPONENT port of app/server/middleware/__tests__/secure-headers.test.ts
// Pure functions returning CSP config objects — no node deps, no middleware execution.
import { cspDirectives, resolveFrameAncestors } from '@/server/middleware/secure-headers';
import { NONCE } from 'hono/secure-headers';

describe('cspDirectives', () => {
  it('allows the Fathom beacon domain in connectSrc in production', () => {
    const csp = cspDirectives(false);
    expect(csp.connectSrc).to.include('https://cdn.usefathom.com');
    expect(csp.connectSrc).to.include("'self'");
    expect(csp.connectSrc).not.to.include('ws:');
  });

  it('keeps the dev websocket entry but still allows Fathom in dev', () => {
    const csp = cspDirectives(true);
    expect(csp.connectSrc).to.include('ws:');
    expect(csp.connectSrc).to.include('https://cdn.usefathom.com');
  });

  it("defaults frameAncestors to 'none' when no override is provided", () => {
    expect(cspDirectives(false).frameAncestors).to.deep.equal(["'none'"]);
    expect(cspDirectives(true).frameAncestors).to.deep.equal(["'none'"]);
  });

  it('uses the provided frame-ancestors allowlist when configured', () => {
    const csp = cspDirectives(false, ["'self'", 'https://staging.example.com']);
    expect(csp.frameAncestors).to.deep.equal(["'self'", 'https://staging.example.com']);
  });
});

describe('CSP style-src policy', () => {
  // style-src intentionally uses 'unsafe-inline' (no nonce) in dev AND prod so CSS-in-JS libs
  // (sonner, Radix) are not refused by the browser. Per CSP3 a nonce would disable
  // 'unsafe-inline', so it must be absent. The real XSS defense — script-src nonce — is unaffected.
  it('production style-src uses unsafe-inline and drops the nonce', () => {
    const prod = cspDirectives(false);
    expect(prod.styleSrc).to.include("'unsafe-inline'");
    expect(prod.styleSrc).not.to.include(NONCE);
    // script-src stays strict — the load-bearing invariant
    expect(prod.scriptSrc).to.include(NONCE);
  });

  it('dev style-src keeps unsafe-inline for HMR', () => {
    const dev = cspDirectives(true);
    expect(dev.styleSrc).to.include("'unsafe-inline'");
  });
});

describe('resolveFrameAncestors', () => {
  it("defaults to 'none' when unset or blank", () => {
    expect(resolveFrameAncestors(undefined)).to.deep.equal(["'none'"]);
    expect(resolveFrameAncestors('')).to.deep.equal(["'none'"]);
    expect(resolveFrameAncestors('   ')).to.deep.equal(["'none'"]);
  });

  it('parses a space- or comma-separated allowlist of origins', () => {
    expect(resolveFrameAncestors('https://a.example.com https://b.example.com')).to.deep.equal([
      'https://a.example.com',
      'https://b.example.com',
    ]);
    expect(resolveFrameAncestors('https://a.example.com, https://b.example.com')).to.deep.equal([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it("supports 'self'", () => {
    expect(resolveFrameAncestors('self')).to.deep.equal(["'self'"]);
    expect(resolveFrameAncestors("'self' https://a.example.com")).to.deep.equal([
      "'self'",
      'https://a.example.com',
    ]);
  });

  it("rejects a bare wildcard and falls back to 'none' (clickjacking footgun)", () => {
    expect(resolveFrameAncestors('*')).to.deep.equal(["'none'"]);
    expect(resolveFrameAncestors('https://a.example.com *')).to.deep.equal(["'none'"]);
  });

  it("treats an explicit 'none' as locked down", () => {
    expect(resolveFrameAncestors('none')).to.deep.equal(["'none'"]);
    expect(resolveFrameAncestors("'none'")).to.deep.equal(["'none'"]);
  });

  it("drops unparseable / non-http(s) tokens, falling back to 'none' if nothing valid remains", () => {
    expect(resolveFrameAncestors('not-a-url')).to.deep.equal(["'none'"]);
    expect(resolveFrameAncestors('ftp://x.example.com')).to.deep.equal(["'none'"]);
    expect(resolveFrameAncestors('https://a.example.com/embed')).to.deep.equal([
      'https://a.example.com',
    ]);
  });
});
