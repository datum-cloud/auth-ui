// cypress/component/resources/verify/email-verification.cy.ts
//
// Component (no-mount) port of app/resources/verify/__tests__/email-verification.test.ts.
// Pure gate function (emailVerificationGate) → browser-side Chai only.
import { emailVerificationGate } from '@/resources/verify/email-verification';

const base = { loginName: 'a@acme.test', organization: 'org1' };

describe('emailVerificationGate', () => {
  it('returns null when the email is already verified', () => {
    expect(emailVerificationGate({ ...base, emailVerified: true, requireVerification: true })).to.be
      .null;
  });
  it('redirects to /verify with send=true when unverified and required', () => {
    const r = emailVerificationGate({ ...base, emailVerified: false, requireVerification: true });
    expect(r?.redirect).to.match(/^\/verify\?/);
    expect(r?.redirect).to.contain('send=true');
    expect(r?.redirect).to.contain('loginName=a%40acme.test');
    expect(r?.redirect).to.contain('organization=org1');
  });
});
