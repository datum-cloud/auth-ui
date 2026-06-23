import { useAuthActionError } from '../use-auth-action-error';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/errors/auth-error-messages', () => ({
  useAuthErrorMessage: () => (code?: string) => (code ? `msg:${code}` : undefined),
}));

describe('useAuthActionError', () => {
  it('resolves the message from actionData.error (inline-only surface, no toast)', () => {
    const { result } = renderHook(() => useAuthActionError({ error: 'INVALID_CREDENTIALS' }));
    expect(result.current).toBe('msg:INVALID_CREDENTIALS');
  });
  it('returns undefined for actionData without an error', () => {
    const { result } = renderHook(() => useAuthActionError(undefined));
    expect(result.current).toBeUndefined();
  });
});
