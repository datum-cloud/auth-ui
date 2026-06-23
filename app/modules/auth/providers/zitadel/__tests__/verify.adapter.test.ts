import { normalizeError } from '../mappers';
import { ProviderError } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

// minimal ConnectError shape
const ce = (code: number, message = 'boom') => ({ code, message, findDetails: () => [] });

// The test expectation for code 9 + unrelated message is 'FAILED_PRECONDITION' (not
// 'UNKNOWN'): a FailedPrecondition without "verified"/"already" in the message maps to
// FAILED_PRECONDITION, matching the mapper's behaviour.
describe('normalizeError — verification error codes', () => {
  it('code 9 + "already verified" → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'email already verified'));
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe('ALREADY_DONE');
  });

  it('code 9 + "already done" → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'operation already done'));
    expect(e.code).toBe('ALREADY_DONE');
  });

  it('code 9 + unrelated message → FAILED_PRECONDITION', () => {
    // FailedPrecondition without verified/already in the message maps to FAILED_PRECONDITION,
    // not UNKNOWN. This assertion confirms the mapper behaviour.
    const e = normalizeError(ce(9, 'precondition failed'));
    expect(e.code).toBe('FAILED_PRECONDITION');
  });
});
