// cypress/component/server/middleware/secure-headers.cy.ts
// COMPONENT port of app/server/middleware/__tests__/secure-headers.test.ts
// Pure functions returning CSP config objects — no node deps, no middleware execution.
// Reduced to one assertion per distinct header/directive concern; dev-vs-prod duplicate
// coverage of the same directive is cut.
import { cspDirectives, resolveFrameAncestors } from '@/server/middleware/secure-headers';
import { NONCE } from 'hono/secure-headers';

describe('cspDirectives', () => {
  it('allows the Rybbit beacon domain in connectSrc in production', () => {
    const csp = cspDirectives(false);
    expect(csp.connectSrc).to.include('https://app.rybbit.io');
    expect(csp.connectSrc).to.include("'self'");
    expect(csp.connectSrc).not.to.include('ws:');
  });

  it('allows the MaxMind fingerprint-submission domains in connectSrc (device.js posts to a rotating *.mmapiws.com endpoint)', () => {
    const csp = cspDirectives(false);
    expect(csp.connectSrc).to.include('https://device.maxmind.com');
    expect(csp.connectSrc).to.include('https://*.mmapiws.com');
  });

  it("defaults frameAncestors to 'none' when no override is provided", () => {
    expect(cspDirectives(false).frameAncestors).to.deep.equal(["'none'"]);
    expect(cspDirectives(true).frameAncestors).to.deep.equal(["'none'"]);
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
});

describe('resolveFrameAncestors', () => {
  // Parsing and token-validation of an OPERATOR-set allowlist (deploy config, not
  // attacker input). Same call, same deep.equal shape, differing only by input string.
  const PARSING: [label: string, input: string, expected: string[]][] = [
    [
      'space-separated allowlist',
      'https://a.example.com https://b.example.com',
      ['https://a.example.com', 'https://b.example.com'],
    ],
    [
      'comma-separated allowlist',
      'https://a.example.com, https://b.example.com',
      ['https://a.example.com', 'https://b.example.com'],
    ],
    ['unparseable token', 'not-a-url', ["'none'"]],
    ['non-http(s) scheme', 'ftp://x.example.com', ["'none'"]],
    ['path stripped to origin', 'https://a.example.com/embed', ['https://a.example.com']],
  ];

  it("parses space- or comma-separated origins and drops unparseable / non-http(s) tokens, falling back to 'none' if nothing valid remains", () => {
    for (const [label, input, expected] of PARSING) {
      expect(resolveFrameAncestors(input), label).to.deep.equal(expected);
    }
  });

  // Kept standalone: this is the clickjacking footgun, not a parsing case. A wildcard
  // that survived would expose every page to framing, so it must fail on its own.
  it("rejects a bare wildcard and falls back to 'none' (clickjacking footgun)", () => {
    expect(resolveFrameAncestors('*')).to.deep.equal(["'none'"]);
    expect(resolveFrameAncestors('https://a.example.com *')).to.deep.equal(["'none'"]);
  });
});
