import { cspDirectives, resolveFrameAncestors } from '@/server/middleware/secure-headers';
import { NONCE } from 'hono/secure-headers';
import { describe, it, expect } from 'vitest';

describe('cspDirectives', () => {
  it('allows the Fathom beacon domain in connectSrc in production', () => {
    const csp = cspDirectives(false);
    expect(csp.connectSrc).toContain('https://cdn.usefathom.com');
    expect(csp.connectSrc).toContain("'self'");
    // No dev-only websocket entry in production.
    expect(csp.connectSrc).not.toContain('ws:');
  });

  it('keeps the dev websocket entry but still allows Fathom in dev', () => {
    const csp = cspDirectives(true);
    expect(csp.connectSrc).toContain('ws:');
    expect(csp.connectSrc).toContain('https://cdn.usefathom.com');
  });

  it("defaults frameAncestors to 'none' when no override is provided", () => {
    expect(cspDirectives(false).frameAncestors).toEqual(["'none'"]);
    expect(cspDirectives(true).frameAncestors).toEqual(["'none'"]);
  });

  it('uses the provided frame-ancestors allowlist when configured', () => {
    const csp = cspDirectives(false, ["'self'", 'https://staging.example.com']);
    expect(csp.frameAncestors).toEqual(["'self'", 'https://staging.example.com']);
  });
});

describe('CSP style-src policy', () => {
  // style-src intentionally uses 'unsafe-inline' (no nonce) in dev AND prod: CSS-in-JS
  // libraries (sonner toasts, Radix UI) inject <style> elements and element.style
  // attributes that cannot carry a nonce, and per CSP3 a nonce in the directive disables
  // 'unsafe-inline'. The real XSS defense — script-src nonce — is unaffected.
  it('production style-src uses unsafe-inline and drops the nonce', () => {
    const prod = cspDirectives(false);
    expect(prod.styleSrc).toContain("'unsafe-inline'");
    expect(prod.styleSrc).not.toContain(NONCE);
    // script-src stays strict — the load-bearing invariant
    expect(prod.scriptSrc).toContain(NONCE);
  });

  it('dev style-src keeps unsafe-inline for HMR', () => {
    const dev = cspDirectives(true);
    expect(dev.styleSrc).toContain("'unsafe-inline'");
  });
});

describe('resolveFrameAncestors', () => {
  it("defaults to 'none' when unset or blank", () => {
    expect(resolveFrameAncestors(undefined)).toEqual(["'none'"]);
    expect(resolveFrameAncestors('')).toEqual(["'none'"]);
    expect(resolveFrameAncestors('   ')).toEqual(["'none'"]);
  });

  it('parses a space- or comma-separated allowlist of origins', () => {
    expect(resolveFrameAncestors('https://a.example.com https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
    expect(resolveFrameAncestors('https://a.example.com, https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it("supports 'self'", () => {
    expect(resolveFrameAncestors('self')).toEqual(["'self'"]);
    expect(resolveFrameAncestors("'self' https://a.example.com")).toEqual([
      "'self'",
      'https://a.example.com',
    ]);
  });

  it("rejects a bare wildcard and falls back to 'none' (clickjacking footgun)", () => {
    expect(resolveFrameAncestors('*')).toEqual(["'none'"]);
    expect(resolveFrameAncestors('https://a.example.com *')).toEqual(["'none'"]);
  });

  it("treats an explicit 'none' as locked down", () => {
    expect(resolveFrameAncestors('none')).toEqual(["'none'"]);
    expect(resolveFrameAncestors("'none'")).toEqual(["'none'"]);
  });

  it("drops unparseable / non-http(s) tokens, falling back to 'none' if nothing valid remains", () => {
    expect(resolveFrameAncestors('not-a-url')).toEqual(["'none'"]);
    expect(resolveFrameAncestors('ftp://x.example.com')).toEqual(["'none'"]);
    // path is stripped down to the origin
    expect(resolveFrameAncestors('https://a.example.com/embed')).toEqual(['https://a.example.com']);
  });
});
