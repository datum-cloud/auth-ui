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
  // 'UNKNOWN' is deliberately outside the ProviderErrorCode union, hence the cast at the call.
  const MAPPINGS: [label: string, input: string | undefined, expected: string][] = [
    ['UNAVAILABLE is the one specific mapping', 'UNAVAILABLE', 'service_unavailable'],
    ['other provider code', 'DEADLINE_EXCEEDED', 'signin_failed'],
    ['unknown code', 'UNKNOWN', 'signin_failed'],
    ['undefined', undefined, 'signin_failed'],
  ];

  it('maps UNAVAILABLE to service_unavailable and falls back to signin_failed for any other code or undefined', () => {
    for (const [label, input, expected] of MAPPINGS) {
      expect(providerErrorCode(input as Parameters<typeof providerErrorCode>[0]), label).to.equal(
        expected
      );
    }
  });

  // Kept standalone: a closure property over the catalog, not an input→output row.
  it('only ever returns a known AuthErrorCode (so authErrorMessage never falls through)', () => {
    const result = providerErrorCode('UNAVAILABLE');
    expect(AUTH_ERRORS[result]).to.not.be.undefined;
  });
});

describe('resolveAuthError', () => {
  it('maps a password-complexity failure to the precise rule code the adapter recorded', () => {
    const RULES = [
      ['symbol', 'PASSWORD_NEEDS_SYMBOL'],
      ['uppercase', 'PASSWORD_NEEDS_UPPERCASE'],
      ['lowercase', 'PASSWORD_NEEDS_LOWERCASE'],
      ['number', 'PASSWORD_NEEDS_NUMBER'],
      ['length', 'PASSWORD_TOO_SHORT'],
    ] as const;
    for (const [passwordRule, expected] of RULES) {
      const err = new ProviderError('PASSWORD_COMPLEXITY', 'policy', false, { passwordRule });
      expect(resolveAuthError(err), passwordRule).to.deep.equal({ error: expected, status: 400 });
    }
  });

  it('keeps PASSWORD_COMPLEXITY when the provider named no rule, whatever the message says', () => {
    const err = new ProviderError('PASSWORD_COMPLEXITY', 'Password must contain symbol');
    expect(resolveAuthError(err)).to.deep.equal({ error: 'PASSWORD_COMPLEXITY', status: 400 });
  });

  // REGRESSION: the resolver used to keyword-match the raw message of EVERY ProviderError, so
  // these showed "Password is too short." / "Password must contain a number." on a non-password
  // failure.
  it('does not map an unrelated failure to a password rule because its message has a rule word', () => {
    const UNRELATED: [code: ProviderError['code'], message: string, status: number][] = [
      ['FAILED_PRECONDITION', 'verification code length is invalid', 400],
      ['INVALID_CREDENTIALS', 'phone number could not be verified', 401],
      ['NOT_FOUND', 'no user for that number', 400],
      ['UNKNOWN', 'symbol table lookup failed in upper/lower bound check', 400],
    ];
    for (const [code, message, status] of UNRELATED) {
      expect(resolveAuthError(new ProviderError(code, message)), message).to.deep.equal({
        error: code,
        status,
      });
    }
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
