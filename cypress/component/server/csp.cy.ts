import { cspDirectives } from '@/server/edge/secure-headers';

describe('CSP: reCAPTCHA', () => {
  it('allows the reCAPTCHA iframe and its network calls', () => {
    const d = cspDirectives(false, ["'none'"]) as Record<string, string[]>;
    expect(d.frameSrc).to.include('https://www.google.com');
    expect(d.connectSrc).to.include('https://www.google.com');
  });

  it('keeps script-src strict — strict-dynamic covers the loader', () => {
    const d = cspDirectives(false, ["'none'"]) as Record<string, string[]>;
    expect(d.scriptSrc).to.not.include('https://www.google.com');
  });
});
