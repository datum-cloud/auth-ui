import { paths } from '@/routes/paths';
import { useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';

/**
 * The recovery affordance descriptor.
 *
 * A *recoverable* auth error code (one the user can act on to get unstuck) maps
 * to an inline recovery action: a destination `paths.*` URL plus a localized
 * label. The adopting routes render this as a `<Link>` INSIDE the
 * `<AuthCeremony>` banner (mirrors `signup/complete`'s "Start over" affordance).
 * Non-recoverable codes (transient/unexpected, field-validation, credential)
 * map to `undefined` — those render the banner message only, no recovery link.
 */
export interface AuthErrorRecovery {
  /** Recovery destination (a typed `paths.*` URL). */
  to: string;
  /** Localized recovery label, e.g. "Sign in again". */
  label: ReactNode;
}

/**
 * Maps an auth error code to its inline recovery affordance, or `undefined` when
 * the code is not recoverable. The set of recoverable codes is deliberately
 * small — only these known dead-end states:
 *
 *   - SESSION_EXPIRED            → "Sign in again" → /login
 *   - NO_SUPPORTED_METHOD        → "Start over"    → /login
 *   - PASSWORD_NOT_ALLOWED       → "Start over"    → /login
 *
 * Returns a resolver so the Lingui `t` macro (a render-time hook) stays inside a
 * component, matching `useAuthErrorMessage`'s shape.
 */
export function useAuthErrorRecovery() {
  const { t } = useLingui();
  return (code: string | undefined): AuthErrorRecovery | undefined => {
    switch (code) {
      case 'SESSION_EXPIRED':
        return { to: paths.login.index(), label: t`Sign in again` };
      case 'NO_SUPPORTED_METHOD':
      case 'PASSWORD_NOT_ALLOWED':
        return { to: paths.login.index(), label: t`Start over` };
      default:
        return undefined;
    }
  };
}
