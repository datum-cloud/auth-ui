// cypress/component/routes/paths.cy.ts
//
// NO-MOUNT: pure function assertions — paths.* builders return the correct URL strings.
// No DOM, no cy.mount(), no cy.task(). Chai `expect()` only.
//
// Migrated from: app/routes/__tests__/paths.test.ts
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

  it('builds passkey-management and reauth paths', () => {
    expect(paths.passkeys()).to.equal('/passkeys');
    expect(paths.reauth()).to.equal('/reauth');
    expect(paths.reauth({ method: 'password', returnTo: '/passkeys' })).to.equal(
      '/reauth?method=password&returnTo=%2Fpasskeys'
    );
    expect(paths.passkeys({ returnTo: 'https://portal.test/settings' })).to.equal(
      '/passkeys?returnTo=https%3A%2F%2Fportal.test%2Fsettings'
    );
  });
});
