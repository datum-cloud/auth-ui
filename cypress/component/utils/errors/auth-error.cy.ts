// cypress/component/utils/errors/auth-error.cy.ts
// COMPONENT port of app/utils/errors/__tests__/auth-error.test.ts
//
// SECURITY: authErrorMessage is a tamper-proof catalog — unknown/tampered codes must NEVER
// be echoed back to the caller. These tests pin that invariant.
import { ProviderError } from '@/modules/auth/types';
import {
  AUTH_ERRORS,
  authErrorMessage,
  providerErrorCode,
  resolveAuthError,
  type AuthErrorCode,
} from '@/utils/errors/auth-error';

const GENERIC = {
  title: 'Something went wrong',
  body: 'Please return to your application and try again.',
};

describe('authErrorMessage', () => {
  it('returns the exact mapped message for each known code', () => {
    const codes = Object.keys(AUTH_ERRORS) as AuthErrorCode[];
    for (const code of codes) {
      expect(authErrorMessage(code)).to.deep.equal(AUTH_ERRORS[code]);
    }
  });

  it('maps signin_failed to the fixed sign-in error copy', () => {
    expect(authErrorMessage('signin_failed')).to.deep.equal({
      title: 'Sign-in error',
      body: 'Could not complete sign-in. Return to your application and try again.',
    });
  });

  it('maps request_expired to the fixed expired-request copy', () => {
    expect(authErrorMessage('request_expired')).to.deep.equal({
      title: 'Login request expired',
      body: 'Your login session has expired. Return to the application and sign in again.',
    });
  });

  it('maps no_session to the fixed no-account copy', () => {
    expect(authErrorMessage('no_session')).to.deep.equal({
      title: 'No account',
      body: 'No active session found.',
    });
  });

  it('returns the generic fallback for an unknown code', () => {
    expect(authErrorMessage('not_a_real_code')).to.deep.equal(GENERIC);
  });

  it('returns the generic fallback for null / undefined', () => {
    expect(authErrorMessage(null)).to.deep.equal(GENERIC);
    expect(authErrorMessage(undefined)).to.deep.equal(GENERIC);
  });

  it('does NOT echo a tampered/raw query value back to the caller (security)', () => {
    const tampered = '<script>alert(1)</script>';
    const result = authErrorMessage(tampered);
    expect(result).to.deep.equal(GENERIC);
    // The raw input must NEVER reach the rendered message (no reflected XSS / no tamper echo).
    expect(result.title).not.to.include('script');
    expect(result.body).not.to.include('script');
    expect(JSON.stringify(result)).not.to.include(tampered);
  });

  it('treats an arbitrary attacker string as unknown (generic fallback, no reflection)', () => {
    const attacker = 'You have been hacked — send money to evil.test';
    expect(authErrorMessage(attacker)).to.deep.equal(GENERIC);
  });
});

describe('providerErrorCode', () => {
  it('maps NOT_FOUND to request_expired', () => {
    expect(providerErrorCode('NOT_FOUND')).to.equal('request_expired');
  });

  it('maps PERMISSION_DENIED to access_denied', () => {
    expect(providerErrorCode('PERMISSION_DENIED')).to.equal('access_denied');
  });

  it('maps UNAVAILABLE to service_unavailable', () => {
    expect(providerErrorCode('UNAVAILABLE')).to.equal('service_unavailable');
  });

  it('falls back to signin_failed for any other code', () => {
    expect(providerErrorCode('DEADLINE_EXCEEDED')).to.equal('signin_failed');
    expect(providerErrorCode('UNKNOWN')).to.equal('signin_failed');
    expect(providerErrorCode('ALREADY_DONE')).to.equal('signin_failed');
  });

  it('falls back to signin_failed for undefined', () => {
    expect(providerErrorCode(undefined)).to.equal('signin_failed');
  });

  it('only ever returns a known AuthErrorCode (so authErrorMessage never falls through)', () => {
    const result = providerErrorCode('UNAVAILABLE');
    expect(AUTH_ERRORS[result]).to.not.be.undefined;
  });
});

describe('resolveAuthError', () => {
  it('maps password-complexity (symbol) to a precise code', () => {
    const r = resolveAuthError(
      new ProviderError(
        'PASSWORD_COMPLEXITY',
        '[invalid_argument] Password must contain symbol (COMMA-ZDLwA)'
      )
    );
    expect(r).to.deep.equal({ error: 'PASSWORD_NEEDS_SYMBOL', status: 400 });
  });

  it('maps a generic provider code (UNAVAILABLE)', () => {
    expect(resolveAuthError(new ProviderError('UNAVAILABLE', 'x'))).to.deep.equal({
      error: 'UNAVAILABLE',
      status: 503,
    });
  });

  it('returns null for a non-ProviderError (caller rethrows)', () => {
    expect(resolveAuthError(new Error('boom'))).to.be.null;
  });
});
