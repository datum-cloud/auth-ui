// cypress/component/resources/otp/otp-email-url-template.cy.ts
//
// Component (no-mount) port of app/resources/otp/__tests__/otp-email-url-template.test.ts.
// otpEmailUrlTemplate is a PURE string builder (origin + basename + RAW Zitadel placeholders).
// KEPT as a security spec: the {{.Code}}/{{.UserID}}/{{.SessionID}} braces MUST stay literal,
// {{.OrgID}} must never appear, real values must be URL-encoded, and the origin is used verbatim
// (no hardcoded https) — the Host-header email-link-injection defense.
import { otpEmailUrlTemplate } from '@/resources/otp/otp-email-url-template';

describe('otpEmailUrlTemplate', () => {
  it('builds an absolute /id/login/verify/email url with RAW (unencoded) OTPEmail placeholders', () => {
    const t = otpEmailUrlTemplate({
      origin: 'http://localhost:3000',
      loginName: 'alice@acme.test',
    });
    expect(t).to.equal(
      'http://localhost:3000/id/login/verify/email?code={{.Code}}&userId={{.UserID}}&sessionId={{.SessionID}}&loginName=alice%40acme.test'
    );
  });

  it('keeps the {{.Code}}/{{.UserID}}/{{.SessionID}} braces literal (never percent-encoded)', () => {
    const t = otpEmailUrlTemplate({ origin: 'https://h', loginName: 'x' });
    expect(t).to.include('code={{.Code}}');
    expect(t).to.include('userId={{.UserID}}');
    expect(t).to.include('sessionId={{.SessionID}}');
    expect(t).to.not.include('%7B');
  });

  it('uses the passed origin VERBATIM, including its scheme (no hardcoded https)', () => {
    const t = otpEmailUrlTemplate({ origin: 'http://localhost:3000', loginName: 'x' });
    expect(t.startsWith('http://localhost:3000/id/')).to.equal(true);
  });
});
