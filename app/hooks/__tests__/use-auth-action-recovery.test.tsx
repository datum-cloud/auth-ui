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
// The mock echoes the ctx it received into the recovery `to`, so a test can assert the
// wrapper FORWARDS the OIDC ceremony context (requestId/organization) down to
// useAuthErrorRecovery (real implementation threads it onto /login).
vi.mock('@/utils/errors/auth-error-recovery', () => ({
  useAuthErrorRecovery: (ctx?: { requestId?: string; organization?: string }) => (code?: string) =>
    code === 'SESSION_EXPIRED'
      ? {
          to: ctx?.requestId ? `/login?requestId=${ctx.requestId}` : '/login',
          label: 'Sign in again',
        }
      : undefined,
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

  // OIDC ceremony preservation: the wrapper forwards the in-scope ceremony context
  // (requestId/organization) to useAuthErrorRecovery so the recovery <Link> returns the
  // user to the relying party. The mock echoes requestId into `to` to prove forwarding.
  it('forwards the ceremony ctx (requestId) to the recovery resolver', () => {
    const { result } = renderHook(() =>
      useAuthActionRecovery(
        { error: 'SESSION_EXPIRED' },
        { requestId: 'rq1', organization: 'acme' }
      )
    );
    expect(result.current.recovery).toEqual({
      to: '/login?requestId=rq1',
      label: 'Sign in again',
    });
  });

  it('yields a bare /login recovery when no ctx is forwarded', () => {
    const { result } = renderHook(() => useAuthActionRecovery({ error: 'SESSION_EXPIRED' }));
    expect(result.current.recovery).toEqual({ to: '/login', label: 'Sign in again' });
  });
});
