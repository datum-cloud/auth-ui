// app/utils/errors/auth-error-codes.ts
//
// The closed set of error codes an action or loader may put in `{ error }` for the inline
// error surface (useAuthErrorMessage). The message map in auth-error-messages.tsx is checked
// against this union with `satisfies`, so a code added here without a message, or a message
// keyed on a code that is not here, fails typecheck.
//
// Pure types + one guard: no React, no i18n, importable from resources and routes alike.
import type { PasswordRule, ProviderErrorCode } from '@/modules/auth/types';

/** The precise password-policy codes resolveAuthError emits for a PASSWORD_COMPLEXITY failure. */
export type PasswordRuleErrorCode =
  | 'PASSWORD_NEEDS_SYMBOL'
  | 'PASSWORD_NEEDS_UPPERCASE'
  | 'PASSWORD_NEEDS_LOWERCASE'
  | 'PASSWORD_NEEDS_NUMBER'
  | 'PASSWORD_TOO_SHORT';

export const PASSWORD_RULE_ERROR_CODE = {
  symbol: 'PASSWORD_NEEDS_SYMBOL',
  uppercase: 'PASSWORD_NEEDS_UPPERCASE',
  lowercase: 'PASSWORD_NEEDS_LOWERCASE',
  number: 'PASSWORD_NEEDS_NUMBER',
  length: 'PASSWORD_TOO_SHORT',
} as const satisfies Record<PasswordRule, PasswordRuleErrorCode>;

/** Codes emitted by app/resources and app/routes (not passed through from the provider). */
export type ResourceErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CODE'
  | 'RECAPTCHA_FAILED'
  | 'USER_NOT_FOUND'
  | 'PHONE_LOGIN_DISABLED'
  | 'EMAIL_LOGIN_DISABLED'
  | 'IDP_UNAVAILABLE'
  | 'SESSION_EXPIRED'
  | 'NO_SUPPORTED_METHOD'
  | 'PASSWORD_NOT_ALLOWED'
  // sso-ldap.ts
  | 'ACCOUNT_NOT_LINKED'
  // otp-enroll.ts
  | 'ENROLL_FAILED'
  // session.service.ts (account switch / sign-out)
  | 'PROVIDER_ERROR'
  // passkeys.service.ts, password.service.ts, webauthn.service.ts
  | 'SUDO_REQUIRED'
  | 'LAST_METHOD'
  // login/passkey-discover.tsx
  | 'DISCOVERY_FAILED'
  | 'ALREADY_SIGNED_IN'
  // signup/complete.tsx, recovery-ceremony.ts, recover/*.tsx
  | 'EXPIRED'
  | 'RECOVERY_EXPIRED'
  // Lowercase outcome codes: device.service.ts, sso-ldap.ts, sso-action.ts.
  | 'not_found'
  | 'invalid_code'
  | 'invalid_input'
  | 'provider_error';

export type AuthActionErrorCode = ProviderErrorCode | PasswordRuleErrorCode | ResourceErrorCode;
