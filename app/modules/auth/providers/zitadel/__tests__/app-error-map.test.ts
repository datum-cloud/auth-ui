import { toAppError } from '../app-error-map';
import { ProviderError } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

describe('toAppError — strict neutral provider→AppError mapping', () => {
  it('maps INVALID_CREDENTIALS → INVALID_CREDENTIALS/401', () => {
    const e = toAppError(new ProviderError('INVALID_CREDENTIALS', 'raw zitadel detail'));
    expect(e.code).toBe('INVALID_CREDENTIALS');
    expect(e.status).toBe(401);
  });
  it('maps PERMISSION_DENIED → FORBIDDEN/403', () => {
    expect(toAppError(new ProviderError('PERMISSION_DENIED', 'x')).code).toBe('FORBIDDEN');
  });
  it('maps ALREADY_EXISTS → CONFLICT/409', () => {
    expect(toAppError(new ProviderError('ALREADY_EXISTS', 'x')).status).toBe(409);
  });
  it('degrades an unknown provider code to UNEXPECTED/500', () => {
    const e = toAppError(new ProviderError('SOME_NEW_CODE' as never, 'x'));
    expect(e.code).toBe('UNEXPECTED');
    expect(e.status).toBe(500);
  });
  it('degrades a non-ProviderError to UNEXPECTED and never leaks raw text', () => {
    const e = toAppError(new Error('postgres exploded at 10.0.0.4'));
    expect(e.code).toBe('UNEXPECTED');
    expect(JSON.stringify(e)).not.toContain('postgres');
  });
});
