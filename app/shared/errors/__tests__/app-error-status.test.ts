import type { AppErrorCode } from '@/shared/errors/app-error';
import { appErrorStatus } from '@/shared/errors/app-error-status';
import { describe, it, expect } from 'vitest';

describe('appErrorStatus — central status map (no blanket 400)', () => {
  const cases: Array<[AppErrorCode, number]> = [
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
  it.each(cases)('maps %s → %i', (code, status) => {
    expect(appErrorStatus(code)).toBe(status);
  });
  it('never returns a blanket 400', () => {
    for (const [code] of cases) expect(appErrorStatus(code)).not.toBe(400);
  });
});
