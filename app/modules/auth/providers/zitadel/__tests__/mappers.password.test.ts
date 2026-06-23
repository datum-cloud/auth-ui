import { toSetPasswordWithCodeRequest } from '../mappers';
import { describe, it, expect } from 'vitest';

describe('toSetPasswordWithCodeRequest', () => {
  it('builds SetPasswordRequest with verificationCode and newPassword', () => {
    const req = toSetPasswordWithCodeRequest('u1', 'CODE', 'NewPw123!');
    expect(req.userId).toBe('u1');
    expect(req.newPassword).toEqual({ password: 'NewPw123!', changeRequired: false });
    expect(req.verification).toEqual({ case: 'verificationCode', value: 'CODE' });
  });

  it('uses the provided userId, code, and password without mutation', () => {
    const req = toSetPasswordWithCodeRequest('user-abc', 'RESET-42', 'Another$ecure1');
    expect(req.userId).toBe('user-abc');
    expect(req.newPassword.password).toBe('Another$ecure1');
    expect(req.verification.case).toBe('verificationCode');
    expect(req.verification.value).toBe('RESET-42');
  });
});
