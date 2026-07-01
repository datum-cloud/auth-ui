// cypress/component/resources/signup/post-register.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/post-register.test.ts.
// Pure routing function → browser-side Chai only.
import { postRegisterStep } from '@/resources/signup/post-register';

const base = { loginName: 'a@acme.test', userId: 'user-1', organization: 'org1' };

describe('postRegisterStep', () => {
  it('routes based on password/verification state, threading userId and requestId', () => {
    expect(
      postRegisterStep({
        ...base,
        hasPassword: false,
        emailVerified: false,
        requireVerification: true,
      })
    ).to.match(/^\/setup\/passkey\?/);

    const toVerify = postRegisterStep({
      ...base,
      hasPassword: true,
      emailVerified: false,
      requireVerification: true,
    });
    expect(toVerify).to.match(/^\/verify\?/);
    expect(toVerify).to.contain('userId=user-1');

    expect(
      postRegisterStep({
        ...base,
        hasPassword: true,
        emailVerified: true,
        requireVerification: true,
      })
    ).to.equal('/signed-in');

    expect(
      postRegisterStep({
        ...base,
        hasPassword: true,
        emailVerified: true,
        requireVerification: true,
        requestId: 'oidc_1',
      })
    ).to.equal('/authorize?requestId=oidc_1');

    expect(
      postRegisterStep({
        ...base,
        hasPassword: true,
        emailVerified: false,
        requireVerification: false,
      })
    ).to.equal('/signed-in');
  });
});
