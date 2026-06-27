// cypress/component/resources/verify/verify-url-template.cy.ts
//
// Component (no-mount) port of app/resources/verify/__tests__/verify-url-template.test.ts.
// Pure URL template builder → browser-side Chai only.
//
// SECURITY: The verify link MUST be built from the trusted PUBLIC_ORIGIN (not the client Host
// header), and placeholders MUST stay as raw braces (Zitadel does NOT decode %7B%7B in email links).
import { verifyUrlTemplate } from '@/resources/verify/verify-url-template';

describe('verifyUrlTemplate', () => {
  it('builds an absolute /id/verify url with RAW (unencoded) provider placeholders', () => {
    const t = verifyUrlTemplate({ origin: 'https://auth.localtest.me:30000' });
    expect(t).to.equal(
      'https://auth.localtest.me:30000/id/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}'
    );
  });

  it('includes the /id app basename so the link lands on auth-ui, not the Zitadel API', () => {
    const verify = verifyUrlTemplate({ origin: 'https://auth.localtest.me:30000' });
    const reset = verifyUrlTemplate({
      origin: 'https://auth.localtest.me:30000',
      path: '/password/new',
    });
    expect(verify.startsWith('https://auth.localtest.me:30000/id/verify?')).to.equal(true);
    expect(reset.startsWith('https://auth.localtest.me:30000/id/password/new?')).to.equal(true);
  });

  it('uses the passed origin VERBATIM, including its scheme (no hardcoded https)', () => {
    const t = verifyUrlTemplate({ origin: 'http://localhost:3000' });
    expect(t).to.equal(
      'http://localhost:3000/id/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}'
    );
    expect(t.startsWith('http://localhost:3000/id/verify?')).to.equal(true);
    expect(t).to.contain('code={{.Code}}');
    expect(t).not.to.contain('%7B');
  });

  it('threads requestId (URL-encoded) when present', () => {
    const t = verifyUrlTemplate({ origin: 'https://h', requestId: 'oidc_9' });
    expect(t).to.contain('&requestId=oidc_9');
  });

  it('url-encodes a requestId with reserved characters', () => {
    const t = verifyUrlTemplate({ origin: 'https://h', requestId: 'a b/c' });
    expect(t).to.contain('&requestId=a%20b%2Fc');
  });

  it('omits requestId when absent', () => {
    const t = verifyUrlTemplate({ origin: 'https://h' });
    expect(t).not.to.contain('requestId=');
  });

  it('adds invite=true when invite is set', () => {
    const t = verifyUrlTemplate({ origin: 'https://h', invite: true });
    expect(t).to.contain('&invite=true');
  });

  it('omits invite when not set', () => {
    const t = verifyUrlTemplate({ origin: 'https://h' });
    expect(t).not.to.contain('invite=');
  });

  it('defaults the path to /verify (under /id) when none is supplied', () => {
    const t = verifyUrlTemplate({ origin: 'https://auth.datum.net' });
    expect(t.startsWith('https://auth.datum.net/id/verify?')).to.equal(true);
  });

  it('builds a /id/password/new template with RAW braces when path is overridden', () => {
    const t = verifyUrlTemplate({ origin: 'https://auth.datum.net', path: '/password/new' });
    expect(t).to.equal(
      'https://auth.datum.net/id/password/new?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}'
    );
    expect(t).to.contain('code={{.Code}}');
    expect(t).not.to.contain('%7B');
  });

  it('threads requestId onto an overridden path (URL-encoded)', () => {
    const t = verifyUrlTemplate({
      origin: 'https://h',
      path: '/password/new',
      requestId: 'a b/c',
    });
    expect(t.startsWith('https://h/id/password/new?')).to.equal(true);
    expect(t).to.contain('&requestId=a%20b%2Fc');
  });
});
