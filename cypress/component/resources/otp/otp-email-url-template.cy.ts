// cypress/component/resources/otp/otp-email-url-template.cy.ts
//
// Component (no-mount) port of app/resources/otp/__tests__/otp-email-url-template.test.ts.
// otpEmailUrlTemplate is a PURE string builder (origin + basename + RAW Zitadel placeholders).
// KEPT as a security spec: the {{.Code}}/{{.UserID}}/{{.SessionID}} braces MUST stay literal,
// {{.OrgID}} must never appear, real values must be URL-encoded, and the origin is used verbatim
// (no hardcoded https) — the Host-header email-link-injection defense.
import { otpEmailUrlTemplate } from '@/resources/otp/otp-email-url-template';

// The dropped third test asserted `startsWith('http://localhost:3000/id/')` for the same
// origin — strictly weaker than the exact-string equal below, which already pins the origin
// verbatim including its scheme. The remaining two cases are one table.
describe('otpEmailUrlTemplate', () => {
  it('builds the verify-email url from a verbatim origin, keeping OTPEmail placeholders literal', () => {
    // Exact string: pins the origin verbatim, the /id basename, raw placeholder braces, and
    // the percent-encoding of the real loginName — all in one assertion.
    expect(
      otpEmailUrlTemplate({ origin: 'http://localhost:3000', loginName: 'alice@acme.test' })
    ).to.equal(
      'http://localhost:3000/id/login/verify/email?code={{.Code}}&userId={{.UserID}}&sessionId={{.SessionID}}&loginName=alice%40acme.test'
    );

    // Braces must survive on a different origin too, and must never be percent-encoded.
    const other = otpEmailUrlTemplate({ origin: 'https://h', loginName: 'x' });
    for (const placeholder of [
      'code={{.Code}}',
      'userId={{.UserID}}',
      'sessionId={{.SessionID}}',
    ]) {
      expect(other, `literal ${placeholder}`).to.include(placeholder);
    }
    expect(other, 'no percent-encoded brace').to.not.include('%7B');
  });
});
