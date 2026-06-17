import { otpEmailUrlTemplate } from './otp-email-url-template';
import { describe, it, expect } from 'vitest';

describe('otpEmailUrlTemplate', () => {
  it('builds an absolute /id/login/verify/email url with RAW (unencoded) OTPEmail placeholders', () => {
    // Zitadel substitutes the RAW {{.Code}} / {{.UserID}} / {{.SessionID}} placeholders
    // when it sends the OTP-email mail — it does NOT URL-decode encoded braces, so they
    // must be literal. OTPEmail does NOT support {{.OrgID}} (unlike the register/verify
    // template), so this helper must not emit it.
    const t = otpEmailUrlTemplate({
      origin: 'http://localhost:3000',
      loginName: 'alice@acme.test',
    });
    expect(t).toBe(
      'http://localhost:3000/id/login/verify/email?code={{.Code}}&userId={{.UserID}}&sessionId={{.SessionID}}&loginName=alice%40acme.test'
    );
  });

  it('includes the /id basename explicitly (trustedAppOrigin returns origin-only)', () => {
    const t = otpEmailUrlTemplate({ origin: 'https://auth.datum.net', loginName: 'x' });
    expect(t.startsWith('https://auth.datum.net/id/login/verify/email?')).toBe(true);
  });

  it('keeps the {{.Code}}/{{.UserID}}/{{.SessionID}} braces literal (never percent-encoded)', () => {
    const t = otpEmailUrlTemplate({ origin: 'https://h', loginName: 'x' });
    expect(t).toContain('code={{.Code}}');
    expect(t).toContain('userId={{.UserID}}');
    expect(t).toContain('sessionId={{.SessionID}}');
    expect(t).not.toContain('%7B');
  });

  it('never emits {{.OrgID}} — OTPEmail does not support that placeholder', () => {
    const t = otpEmailUrlTemplate({
      origin: 'https://h',
      loginName: 'x',
      organization: 'acme',
    });
    expect(t).not.toContain('{{.OrgID}}');
  });

  it('encodes the loginName (a real value, not a placeholder)', () => {
    const t = otpEmailUrlTemplate({ origin: 'https://h', loginName: 'a b/c@d' });
    expect(t).toContain('&loginName=a%20b%2Fc%40d');
  });

  it('threads requestId (URL-encoded) when present, omits it otherwise', () => {
    const withReq = otpEmailUrlTemplate({
      origin: 'https://h',
      loginName: 'x',
      requestId: 'a b/c',
    });
    expect(withReq).toContain('&requestId=a%20b%2Fc');
    const without = otpEmailUrlTemplate({ origin: 'https://h', loginName: 'x' });
    expect(without).not.toContain('requestId=');
  });

  it('threads organization (URL-encoded) when present, omits it otherwise', () => {
    const withOrg = otpEmailUrlTemplate({
      origin: 'https://h',
      loginName: 'x',
      organization: 'acme corp',
    });
    expect(withOrg).toContain('&organization=acme%20corp');
    const without = otpEmailUrlTemplate({ origin: 'https://h', loginName: 'x' });
    expect(without).not.toContain('organization=');
  });

  it('uses the passed origin VERBATIM, including its scheme (no hardcoded https)', () => {
    const t = otpEmailUrlTemplate({ origin: 'http://localhost:3000', loginName: 'x' });
    expect(t.startsWith('http://localhost:3000/id/')).toBe(true);
  });
});
