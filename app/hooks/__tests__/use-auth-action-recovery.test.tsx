// @vitest-environment happy-dom
//
// useAuthActionRecovery is the recovery-aware sibling of
// useAuthActionError. It resolves BOTH the inline message (via useAuthErrorMessage)
// AND the recovery affordance (via useAuthErrorRecovery) from actionData.error, so
// the adopting routes can render an inline banner + a recovery <Link> inside
// <AuthCeremony>. It must NOT fire a toast (inline-only surface).
import { useAuthActionRecovery } from '../use-auth-action-recovery';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/errors/auth-error-messages', () => ({
  useAuthErrorMessage: () => (code?: string) => (code ? `msg:${code}` : undefined),
}));
vi.mock('@/utils/errors/auth-error-recovery', () => ({
  useAuthErrorRecovery: () => (code?: string) =>
    code === 'SESSION_EXPIRED' ? { to: '/login', label: 'Sign in again' } : undefined,
}));

describe('useAuthActionRecovery', () => {
  it('resolves message + recovery for a recoverable code (inline-only surface, no toast)', () => {
    const { result } = renderHook(() => useAuthActionRecovery({ error: 'SESSION_EXPIRED' }));
    expect(result.current.message).toBe('msg:SESSION_EXPIRED');
    expect(result.current.recovery).toEqual({ to: '/login', label: 'Sign in again' });
  });

  it('resolves message but no recovery for a non-recoverable code', () => {
    const { result } = renderHook(() => useAuthActionRecovery({ error: 'INVALID_CREDENTIALS' }));
    expect(result.current.message).toBe('msg:INVALID_CREDENTIALS');
    expect(result.current.recovery).toBeUndefined();
  });

  it('returns undefined message + recovery when actionData has no error', () => {
    const { result } = renderHook(() => useAuthActionRecovery(undefined));
    expect(result.current.message).toBeUndefined();
    expect(result.current.recovery).toBeUndefined();
  });
});
