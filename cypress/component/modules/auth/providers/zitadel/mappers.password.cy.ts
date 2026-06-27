// cypress/component/modules/auth/providers/zitadel/mappers.password.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.password.test.ts.
// Pure toSetPasswordWithCodeRequest mapper — browser-side Chai only.
import { toSetPasswordWithCodeRequest } from '@/modules/auth/providers/zitadel/mappers';

describe('toSetPasswordWithCodeRequest', () => {
  it('builds SetPasswordRequest with verificationCode and newPassword', () => {
    const req = toSetPasswordWithCodeRequest('u1', 'CODE', 'NewPw123!');
    expect(req.userId).to.equal('u1');
    expect(req.newPassword).to.deep.equal({ password: 'NewPw123!', changeRequired: false });
    expect(req.verification).to.deep.equal({ case: 'verificationCode', value: 'CODE' });
  });

  it('uses the provided userId, code, and password without mutation', () => {
    const req = toSetPasswordWithCodeRequest('user-abc', 'RESET-42', 'Another$ecure1');
    expect(req.userId).to.equal('user-abc');
    expect(req.newPassword.password).to.equal('Another$ecure1');
    expect(req.verification.case).to.equal('verificationCode');
    expect(req.verification.value).to.equal('RESET-42');
  });
});
