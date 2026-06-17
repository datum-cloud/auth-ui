import { AUTH_ERRORS, authErrorMessage, providerErrorCode, type AuthErrorCode } from './auth-error';
import { describe, it, expect } from 'vitest';

const GENERIC = {
  title: 'Something went wrong',
  body: 'Please return to your application and try again.',
};

describe('authErrorMessage', () => {
  it('returns the exact mapped message for each known code', () => {
    const codes = Object.keys(AUTH_ERRORS) as AuthErrorCode[];
    for (const code of codes) {
      expect(authErrorMessage(code)).toEqual(AUTH_ERRORS[code]);
    }
  });

  it('maps signin_failed to the fixed sign-in error copy', () => {
    expect(authErrorMessage('signin_failed')).toEqual({
      title: 'Sign-in error',
      body: 'Could not complete sign-in. Return to your application and try again.',
    });
  });

  it('maps request_expired to the fixed expired-request copy', () => {
    expect(authErrorMessage('request_expired')).toEqual({
      title: 'Login request expired',
      body: 'Your login session has expired. Return to the application and sign in again.',
    });
  });

  it('maps no_session to the fixed no-account copy', () => {
    expect(authErrorMessage('no_session')).toEqual({
      title: 'No account',
      body: 'No active session found.',
    });
  });

  it('returns the generic fallback for an unknown code', () => {
    expect(authErrorMessage('not_a_real_code')).toEqual(GENERIC);
  });

  it('returns the generic fallback for null / undefined', () => {
    expect(authErrorMessage(null)).toEqual(GENERIC);
    expect(authErrorMessage(undefined)).toEqual(GENERIC);
  });

  it('does NOT echo a tampered/raw query value back to the caller', () => {
    const tampered = '<script>alert(1)</script>';
    const result = authErrorMessage(tampered);
    expect(result).toEqual(GENERIC);
    // The raw input must never reach the rendered message (no reflected XSS / no tamper).
    expect(result.title).not.toContain('script');
    expect(result.body).not.toContain('script');
    expect(JSON.stringify(result)).not.toContain(tampered);
  });

  it('treats an arbitrary attacker string as unknown (generic fallback, no reflection)', () => {
    const attacker = 'You have been hacked — send money to evil.test';
    expect(authErrorMessage(attacker)).toEqual(GENERIC);
  });
});

describe('providerErrorCode', () => {
  it('maps NOT_FOUND to request_expired', () => {
    expect(providerErrorCode('NOT_FOUND')).toBe('request_expired');
  });

  it('maps PERMISSION_DENIED to access_denied', () => {
    expect(providerErrorCode('PERMISSION_DENIED')).toBe('access_denied');
  });

  it('maps UNAVAILABLE to service_unavailable', () => {
    expect(providerErrorCode('UNAVAILABLE')).toBe('service_unavailable');
  });

  it('falls back to signin_failed for any other code', () => {
    expect(providerErrorCode('DEADLINE_EXCEEDED')).toBe('signin_failed');
    expect(providerErrorCode('UNKNOWN')).toBe('signin_failed');
    expect(providerErrorCode('ALREADY_DONE')).toBe('signin_failed');
  });

  it('falls back to signin_failed for undefined', () => {
    expect(providerErrorCode(undefined)).toBe('signin_failed');
  });

  it('only ever returns a known AuthErrorCode (so authErrorMessage never falls through)', () => {
    const result = providerErrorCode('UNAVAILABLE');
    expect(AUTH_ERRORS[result]).toBeDefined();
  });
});
