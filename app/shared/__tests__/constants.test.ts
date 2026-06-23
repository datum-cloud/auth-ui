import { CSRF_FORM_KEY as fromBarrel } from '@/shared';
import { CSRF_FORM_KEY } from '@/shared/constants';
import { describe, it, expect } from 'vitest';

describe('app/shared kernel', () => {
  it('exposes CSRF_FORM_KEY as the literal "csrf" (byte-frozen field name)', () => {
    expect(CSRF_FORM_KEY).toBe('csrf');
  });
  it('re-exports CSRF_FORM_KEY through the barrel', () => {
    expect(fromBarrel).toBe('csrf');
  });
});
