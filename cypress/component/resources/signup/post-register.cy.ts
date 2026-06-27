// cypress/component/resources/signup/post-register.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/post-register.test.ts.
// Pure routing function → browser-side Chai only.
import { postRegisterStep } from '@/resources/signup/post-register';

const base = { loginName: 'a@acme.test', userId: 'user-1', organization: 'org1' };

describe('postRegisterStep', () => {
  it('routes a no-password registration to passkey setup', () => {
    expect(
      postRegisterStep({
        ...base,
        hasPassword: false,
        emailVerified: false,
        requireVerification: true,
      })
    ).to.match(/^\/setup\/passkey\?/);
  });
  it('routes password + verification-required + unverified to /verify, threading userId', () => {
    const r = postRegisterStep({
      ...base,
      hasPassword: true,
      emailVerified: false,
      requireVerification: true,
    });
    expect(r).to.match(/^\/verify\?/);
    expect(r).to.contain('userId=user-1');
  });
  it('routes password + verified to /signed-in when no requestId', () => {
    expect(
      postRegisterStep({
        ...base,
        hasPassword: true,
        emailVerified: true,
        requireVerification: true,
      })
    ).to.equal('/signed-in');
  });
  it('hands back to /authorize when a requestId is present', () => {
    expect(
      postRegisterStep({
        ...base,
        hasPassword: true,
        emailVerified: true,
        requireVerification: true,
        requestId: 'oidc_1',
      })
    ).to.equal('/authorize?requestId=oidc_1');
  });
  it('skips /verify when verification is not required', () => {
    expect(
      postRegisterStep({
        ...base,
        hasPassword: true,
        emailVerified: false,
        requireVerification: false,
      })
    ).to.equal('/signed-in');
  });
  it('routes passwordless (passkey) signup to /setup/passkey with checkAfter=true', () => {
    const target = postRegisterStep({
      loginName: 'a@x.com',
      userId: 'u1',
      hasPassword: false,
      emailVerified: false,
      requireVerification: false,
    });
    expect(target).to.contain('/setup/passkey');
    expect(target).to.contain('checkAfter=true');
    expect(target).to.contain('force=false');
  });
});
