// cypress/component/modules/auth/providers/zitadel/mappers.password.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.password.test.ts.
// Pure toSetPasswordWithCodeRequest mapper — browser-side Chai only.
import { toSetPasswordWithCodeRequest } from '@/modules/auth/providers/zitadel/mappers';

describe('toSetPasswordWithCodeRequest', () => {
  it('builds SetPasswordRequest with verificationCode and newPassword from the given userId/code/password', () => {
    const req = toSetPasswordWithCodeRequest('user-abc', 'RESET-42', 'Another$ecure1');
    expect(req.userId).to.equal('user-abc');
    expect(req.newPassword).to.deep.equal({ password: 'Another$ecure1', changeRequired: false });
    expect(req.verification).to.deep.equal({ case: 'verificationCode', value: 'RESET-42' });
  });
});
