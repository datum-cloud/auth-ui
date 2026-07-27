// cypress/component/resources/shared/return-to.cy.ts
//
// NO-MOUNT: fail-closed returnTo guard. Allowlist injected so the browser
// bundle never parses server env — same injectability rationale as validatePostLogoutRedirect.
import { validateReturnTo } from '@/resources/shared/return-to';

describe('validateReturnTo — fail-closed returnTo guard', () => {
  const allow = ['https://portal.staging.env.datum.net'];
  it('accepts app-relative paths (served under /id by the basename)', () => {
    expect(validateReturnTo('/passkeys', allow)).to.equal('/passkeys');
    expect(validateReturnTo('/setup/passkey?loginName=a%40b.c', allow)).to.equal(
      '/setup/passkey?loginName=a%40b.c'
    );
  });
  it('rejects scheme-relative, backslash, and non-allowlisted absolute URLs', () => {
    expect(validateReturnTo('//evil.test/x', allow)).to.equal(null);
    expect(validateReturnTo('/\\evil.test', allow)).to.equal(null);
    expect(validateReturnTo('https://evil.test/cb', allow)).to.equal(null);
    expect(validateReturnTo(null, allow)).to.equal(null);
  });
  it('accepts an allowlisted external origin (portal entry-point round-trip)', () => {
    expect(validateReturnTo('https://portal.staging.env.datum.net/settings', allow)).to.equal(
      'https://portal.staging.env.datum.net/settings'
    );
  });
});
