// Tamper-proof error model for /id/error.
//
// The error page used to render `?title=` / `?error=` straight from the URL — ugly AND
// user-tamperable (anyone could rewrite the message via the query string). Instead, redirects
// now carry a known `?code=`, and the page maps it to a FIXED message here. The raw query value
// is never reflected into the DOM: an unknown/missing/tampered code falls back to a generic
// message, so an attacker can never inject arbitrary copy.
//
// Boundary: this module is pure and imports provider TYPES only (no provider implementation).
// No i18n — these are plain English strings (the error page renders them untranslated by design).
import type { ProviderError } from '@/modules/auth/types';

export type AuthErrorCode =
  | 'request_expired'
  | 'access_denied'
  | 'service_unavailable'
  | 'signin_failed'
  | 'no_request'
  | 'no_session'
  | 'saml_failed';

interface AuthErrorMessage {
  title: string;
  body: string;
}

// Exact copy preserved from the former inline objects + authRequestError mapper in authorize.tsx
// and errorRedirectPath in saml-post.ts. Changing these strings is a user-facing copy change.
export const AUTH_ERRORS: Record<AuthErrorCode, AuthErrorMessage> = {
  request_expired: {
    title: 'Login request expired',
    body: 'Your login session has expired. Return to the application and sign in again.',
  },
  access_denied: {
    title: 'Access denied',
    body: 'You do not have permission to access this login request.',
  },
  service_unavailable: {
    title: 'Service unavailable',
    body: 'The authentication service is temporarily unavailable. Please try again shortly.',
  },
  signin_failed: {
    title: 'Sign-in error',
    body: 'Could not complete sign-in. Return to your application and try again.',
  },
  no_request: {
    title: 'No login request',
    body: 'Start sign-in from your application.',
  },
  no_session: {
    title: 'No account',
    body: 'No active session found.',
  },
  saml_failed: {
    title: 'Sign-in error',
    body: 'Could not complete SAML sign-in. Return to your application and try again.',
  },
};

// Safe generic fallback for unknown/missing/tampered codes. The raw query value is NEVER reflected
// — an attacker rewriting `?code=` only ever sees this fixed, harmless message.
const GENERIC_ERROR: AuthErrorMessage = {
  title: 'Something went wrong',
  body: 'Please return to your application and try again.',
};

function isAuthErrorCode(code: string): code is AuthErrorCode {
  return Object.prototype.hasOwnProperty.call(AUTH_ERRORS, code);
}

/**
 * Look up the fixed message for a KNOWN error code. Unknown, missing, or tampered values return
 * the generic fallback — the input is never echoed back, so no attacker-controlled text can reach
 * the rendered page.
 */
export function authErrorMessage(code: string | null | undefined): AuthErrorMessage {
  if (typeof code === 'string' && isAuthErrorCode(code)) {
    return AUTH_ERRORS[code];
  }
  return GENERIC_ERROR;
}

/**
 * Map a ProviderError code to the AuthErrorCode used in the /error redirect (replaces the former
 * authRequestError helper). Anything outside the explicit set degrades to signin_failed.
 */
export function providerErrorCode(code: ProviderError['code'] | undefined): AuthErrorCode {
  switch (code) {
    case 'NOT_FOUND':
      return 'request_expired';
    case 'PERMISSION_DENIED':
      return 'access_denied';
    case 'UNAVAILABLE':
      return 'service_unavailable';
    default:
      return 'signin_failed';
  }
}
