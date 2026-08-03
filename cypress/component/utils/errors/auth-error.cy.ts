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
  it('returns the exact mapped message for every known code, and the generic fallback for an unknown code or null/undefined', () => {
    // Every catalogued code resolves to its own entry...
    const codes = Object.keys(AUTH_ERRORS) as AuthErrorCode[];
    for (const code of codes) {
      expect(authErrorMessage(code), `known code ${code}`).to.deep.equal(AUTH_ERRORS[code]);
    }

    // ...and everything outside the catalog collapses to the generic message.
    const UNKNOWN: [label: string, input: string | null | undefined][] = [
      ['unknown code', 'not_a_real_code'],
      ['null', null],
      ['undefined', undefined],
    ];
    for (const [label, input] of UNKNOWN) {
      expect(authErrorMessage(input), label).to.deep.equal(GENERIC);
    }
  });

  // Kept standalone: the tamper/XSS invariant, with its own not.include assertions.
  it('does NOT echo a tampered/raw query value back to the caller (security)', () => {
    const tampered = '<script>alert(1)</script>';
    const result = authErrorMessage(tampered);
    expect(result).to.deep.equal(GENERIC);
    // The raw input must NEVER reach the rendered message (no reflected XSS / no tamper echo).
    expect(result.title).not.to.include('script');
    expect(result.body).not.to.include('script');
    expect(JSON.stringify(result)).not.to.include(tampered);
  });
});

describe('providerErrorCode', () => {
  const MAPPINGS: [label: string, input: string | undefined, expected: string][] = [
    ['UNAVAILABLE is the one specific mapping', 'UNAVAILABLE', 'service_unavailable'],
    ['other provider code', 'DEADLINE_EXCEEDED', 'signin_failed'],
    ['unknown code', 'UNKNOWN', 'signin_failed'],
    ['undefined', undefined, 'signin_failed'],
  ];

  it('maps UNAVAILABLE to service_unavailable and falls back to signin_failed for any other code or undefined', () => {
    for (const [label, input, expected] of MAPPINGS) {
      expect(providerErrorCode(input), label).to.equal(expected);
    }
  });

  // Kept standalone: a closure property over the catalog, not an input→output row.
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
