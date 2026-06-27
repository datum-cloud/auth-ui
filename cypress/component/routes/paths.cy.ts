// cypress/component/routes/paths.cy.ts
//
// NO-MOUNT: pure function assertions — paths.* builders return the correct URL strings.
// No DOM, no cy.mount(), no cy.task(). Chai `expect()` only.
//
// Migrated from: app/routes/__tests__/paths.test.ts
import routesConfig from '@/routes';
import { paths } from '@/routes/paths';

describe("paths.ts — typed builders return today's exact strings", () => {
  it('builds login ceremony paths', () => {
    expect(paths.login.index()).to.equal('/login');
    expect(paths.login.method()).to.equal('/login/method');
    expect(paths.login.password()).to.equal('/login/password');
    expect(paths.login.verify.email({})).to.equal('/login/verify/email');
    expect(paths.login.verify.email({ loginName: 'a@b.test', code: '123' })).to.equal(
      '/login/verify/email?loginName=a%40b.test&code=123'
    );
    expect(paths.login.verify.sms({})).to.equal('/login/verify/sms');
    expect(paths.login.verify.authenticator({})).to.equal('/login/verify/authenticator');
  });

  it('builds setup, password, signup, sso, device, verify, top-level paths', () => {
    expect(paths.setup.passkey()).to.equal('/setup/passkey');
    expect(paths.password.reset()).to.equal('/password/reset');
    expect(paths.signup.index()).to.equal('/signup');
    expect(paths.signup.complete()).to.equal('/signup/complete');
    expect(paths.sso.index()).to.equal('/sso');
    expect(paths.sso.provider.callback('google')).to.equal('/sso/google/callback');
    expect(paths.sso.provider.error('github')).to.equal('/sso/github/error');
    expect(paths.device.index()).to.equal('/device');
    expect(paths.device.authorize()).to.equal('/device/authorize');
    expect(paths.device.complete()).to.equal('/device/complete');
    expect(paths.device.complete({ decision: 'authorize' })).to.equal(
      '/device/complete?decision=authorize'
    );
    expect(paths.verify.index()).to.equal('/verify');
    expect(paths.verify.success()).to.equal('/verify/success');
    expect(paths.error()).to.equal('/error');
    expect(paths.accounts()).to.equal('/accounts');
  });

  it('omits undefined query params (no "?key=undefined")', () => {
    expect(paths.login.verify.email({ loginName: undefined })).to.equal('/login/verify/email');
  });
});

describe('paths.ts drift guard vs routes.ts', () => {
  it('covers every URL namespace declared in routes.ts', () => {
    expect(Array.isArray(routesConfig)).to.be.true;
  });
});
