// @vitest-environment happy-dom
//
// The recovery map carries an inline recovery affordance for the
// RECOVERABLE auth error codes (SESSION_EXPIRED → "Sign in again",
// NO_SUPPORTED_METHOD / PASSWORD_NOT_ALLOWED → "Start over"). Non-recoverable
// codes (and undefined) resolve to no recovery, so the banner renders message-only.
import { useAuthErrorRecovery } from '../auth-error-recovery';
import { paths } from '@/routes/paths';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';

// Lingui macro is a Babel transform — passthrough the label string under vitest's esbuild.
vi.mock('@lingui/react/macro', () => ({
  useLingui: () => ({ t: (s: TemplateStringsArray) => s.join('') }),
}));

function resolve(code: string | undefined, ctx?: { requestId?: string; organization?: string }) {
  const { result } = renderHook(() => useAuthErrorRecovery(ctx));
  return result.current(code);
}

describe('useAuthErrorRecovery', () => {
  it('maps SESSION_EXPIRED to a "Sign in again" recovery pointing at paths.login.index()', () => {
    const recovery = resolve('SESSION_EXPIRED');
    expect(recovery).toBeDefined();
    expect(recovery?.to).toBe(paths.login.index());
    expect(recovery?.label as ReactNode).toBe('Sign in again');
  });

  it('maps NO_SUPPORTED_METHOD to a "Start over" recovery pointing at paths.login.index()', () => {
    const recovery = resolve('NO_SUPPORTED_METHOD');
    expect(recovery).toBeDefined();
    expect(recovery?.to).toBe(paths.login.index());
    expect(recovery?.label as ReactNode).toBe('Start over');
  });

  it('maps PASSWORD_NOT_ALLOWED to a "Start over" recovery pointing at paths.login.index()', () => {
    const recovery = resolve('PASSWORD_NOT_ALLOWED');
    expect(recovery).toBeDefined();
    expect(recovery?.to).toBe(paths.login.index());
    expect(recovery?.label as ReactNode).toBe('Start over');
  });

  it('returns undefined for a non-recoverable code (transient/unexpected → banner only)', () => {
    expect(resolve('INVALID_CREDENTIALS')).toBeUndefined();
    expect(resolve('RATE_LIMITED')).toBeUndefined();
    expect(resolve('UNEXPECTED')).toBeUndefined();
  });

  it('returns undefined when there is no error code', () => {
    expect(resolve(undefined)).toBeUndefined();
  });

  // OIDC ceremony preservation: when the in-scope ceremony context (requestId +
  // organization) is supplied, the recovery destination threads them onto /login so a
  // mid-OIDC user returns to the relying party instead of dead-ending at the default
  // post-login redirect. Without ctx (non-OIDC flow), the bare /login is preserved.
  it('threads requestId + organization onto the recovery destination when ctx is provided', () => {
    const recovery = resolve('SESSION_EXPIRED', { requestId: 'rq1', organization: 'acme' });
    expect(recovery?.to).toBe(paths.login.index({ requestId: 'rq1', organization: 'acme' }));
    expect(recovery?.to).toBe('/login?requestId=rq1&organization=acme');
  });

  it('threads requestId alone when ctx has no organization', () => {
    const recovery = resolve('NO_SUPPORTED_METHOD', { requestId: 'rq1' });
    expect(recovery?.to).toBe('/login?requestId=rq1');
  });

  it('keeps the bare /login when ctx is absent (non-OIDC flow)', () => {
    expect(resolve('SESSION_EXPIRED')?.to).toBe(paths.login.index());
    expect(resolve('SESSION_EXPIRED')?.to).toBe('/login');
  });

  it('keeps the bare /login when ctx has no requestId (organization alone is not enough)', () => {
    expect(resolve('SESSION_EXPIRED', { organization: 'acme' })?.to).toBe('/login');
  });
});
