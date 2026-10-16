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
    expect(validateReturnTo('//datum.test/x', allow)).to.equal(null);
    expect(validateReturnTo('/\\datum.test', allow)).to.equal(null);
    expect(validateReturnTo('https://datum.test/cb', allow)).to.equal(null);
    expect(validateReturnTo(null, allow)).to.equal(null);
  });
  // WHATWG URL parsing strips tab/newline, so '/<tab>/host' becomes '//host' in the
  // browser. A prefix check passes these; only a real parse catches them.
  it('rejects paths a browser resolves to another site after stripping tab or newline', () => {
    expect(validateReturnTo('/\t/datum.test', allow)).to.equal(null);
    expect(validateReturnTo('/\n/datum.test', allow)).to.equal(null);
    expect(validateReturnTo('/\r/datum.test', allow)).to.equal(null);
    expect(validateReturnTo('/\\/datum.test', allow)).to.equal(null);
  });
  it('still accepts an encoded backslash, which stays inside the path', () => {
    expect(validateReturnTo('/passkeys/%5Cx', allow)).to.equal('/passkeys/%5Cx');
  });
  it('accepts an allowlisted external origin (portal entry-point round-trip)', () => {
    expect(validateReturnTo('https://portal.staging.env.datum.net/settings', allow)).to.equal(
      'https://portal.staging.env.datum.net/settings'
    );
  });
});
