// cypress/component/shared/app-error-status.cy.ts
// COMPONENT port of app/shared/errors/__tests__/app-error-status.test.ts
// Pure mapping function: AppErrorCode → HTTP status. No DOM / render needed.
import type { AppErrorCode } from '@/shared/errors/app-error';
import { appErrorStatus } from '@/shared/errors/app-error-status';

const CASES: Array<[AppErrorCode, number]> = [
  ['INVALID_INPUT', 422],
  ['INVALID_CREDENTIALS', 401],
  ['SESSION_EXPIRED', 401],
  ['NO_SUPPORTED_METHOD', 422],
  ['PASSWORD_NOT_ALLOWED', 422],
  ['RATE_LIMITED', 429],
  ['FORBIDDEN', 403],
  ['CONFLICT', 409],
  ['UNEXPECTED', 500],
];

describe('appErrorStatus — central status map (no blanket 400)', () => {
  CASES.forEach(([code, status]) => {
    it(`maps ${code} → ${status}`, () => {
      expect(appErrorStatus(code)).to.equal(status);
    });
  });

  it('never returns a blanket 400', () => {
    CASES.forEach(([code]) => {
      expect(appErrorStatus(code)).not.to.equal(400);
    });
  });
});
