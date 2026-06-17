import { normalizeError } from './mappers';
import { ProviderError } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

// minimal ConnectError shape
const ce = (code: number, message = 'boom') => ({ code, message, findDetails: () => [] });

// Task 11 (CODE-MIN-02) follow-up: the test expectation for code 9 + unrelated message was
// updated from 'UNKNOWN' to 'FAILED_PRECONDITION' to align with the mapper fix that landed in
// Task 11's commit (3ce9d00). This update was inadvertently bundled into the Task 12 commit;
// it is logically owned by Task 11 and is re-attributed here for audit clarity.
describe('normalizeError — verification error codes (Task 7 confirming tests + Task 11 follow-up)', () => {
  it('code 9 + "already verified" → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'email already verified'));
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe('ALREADY_DONE');
  });

  it('code 9 + "already done" → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'operation already done'));
    expect(e.code).toBe('ALREADY_DONE');
  });

  it('code 9 + unrelated message → FAILED_PRECONDITION (CODE-MIN-02)', () => {
    // FailedPrecondition without verified/already in the message maps to FAILED_PRECONDITION,
    // not UNKNOWN — fixed in Task 11 (CODE-MIN-02). This assertion confirms the mapper fix.
    const e = normalizeError(ce(9, 'precondition failed'));
    expect(e.code).toBe('FAILED_PRECONDITION');
  });
});
