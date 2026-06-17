import { cspDirectives } from '@/server/middleware/secure-headers';
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

  it('keeps frameAncestors hardcoded to none (auth UI is never embeddable)', () => {
    expect(cspDirectives(false).frameAncestors).toEqual(["'none'"]);
    expect(cspDirectives(true).frameAncestors).toEqual(["'none'"]);
  });
});
