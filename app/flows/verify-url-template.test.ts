import { verifyUrlTemplate } from './verify-url-template';
import { describe, it, expect } from 'vitest';

describe('verifyUrlTemplate', () => {
  it('builds an absolute /verify url with RAW (unencoded) provider placeholders', () => {
    // Zitadel only substitutes RAW {{.Code}} / {{.UserID}} / {{.OrgID}} — it does
    // NOT decode URL-encoded braces (%7B%7B...), so the placeholders must be literal
    // (verified live against Zitadel: encoded braces are left untouched in the mail).
    const t = verifyUrlTemplate({ origin: 'https://auth.localtest.me:30000' });
    expect(t).toBe(
      'https://auth.localtest.me:30000/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}'
    );
  });

  it('uses the passed origin VERBATIM, including its scheme (no hardcoded https)', () => {
    // SECURITY/correctness: the origin (scheme + host) is supplied by the caller from
    // trusted config (PUBLIC_ORIGIN). The helper must NOT prepend https:// itself — an
    // http://localhost:3000 origin must yield an http link, and the host must be taken
    // verbatim from the origin (never the request Host header).
    const t = verifyUrlTemplate({ origin: 'http://localhost:3000' });
    expect(t).toBe(
      'http://localhost:3000/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}'
    );
    expect(t.startsWith('http://localhost:3000/verify?')).toBe(true);
    // placeholders stay raw-brace (not URL-encoded)
    expect(t).toContain('code={{.Code}}');
    expect(t).not.toContain('%7B');
  });

  it('threads requestId (URL-encoded) when present', () => {
    const t = verifyUrlTemplate({ origin: 'https://h', requestId: 'oidc_9' });
    expect(t).toContain('&requestId=oidc_9');
  });

  it('url-encodes a requestId with reserved characters', () => {
    const t = verifyUrlTemplate({ origin: 'https://h', requestId: 'a b/c' });
    expect(t).toContain('&requestId=a%20b%2Fc');
  });

  it('omits requestId when absent', () => {
    const t = verifyUrlTemplate({ origin: 'https://h' });
    expect(t).not.toContain('requestId=');
  });

  it('adds invite=true when invite is set', () => {
    const t = verifyUrlTemplate({ origin: 'https://h', invite: true });
    expect(t).toContain('&invite=true');
  });

  it('omits invite when not set', () => {
    const t = verifyUrlTemplate({ origin: 'https://h' });
    expect(t).not.toContain('invite=');
  });

  it('defaults the path to /verify when none is supplied', () => {
    const t = verifyUrlTemplate({ origin: 'https://auth.datum.net' });
    expect(t.startsWith('https://auth.datum.net/verify?')).toBe(true);
  });

  it('builds a /password/new template with RAW braces when path is overridden', () => {
    // The password-reset email link targets OUR /password/new route, not /verify.
    // It must reuse the SAME trusted-origin + raw-brace contract (the braces are
    // provider-side placeholders Zitadel does NOT URL-decode), so URLSearchParams
    // (which percent-encodes the braces) cannot be used.
    const t = verifyUrlTemplate({ origin: 'https://auth.datum.net', path: '/password/new' });
    expect(t).toBe(
      'https://auth.datum.net/password/new?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}'
    );
    // braces stay literal — never percent-encoded
    expect(t).toContain('code={{.Code}}');
    expect(t).not.toContain('%7B');
  });

  it('threads requestId onto an overridden path (URL-encoded)', () => {
    const t = verifyUrlTemplate({
      origin: 'https://h',
      path: '/password/new',
      requestId: 'a b/c',
    });
    expect(t.startsWith('https://h/password/new?')).toBe(true);
    expect(t).toContain('&requestId=a%20b%2Fc');
  });
});
