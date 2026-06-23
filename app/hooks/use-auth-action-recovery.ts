import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { useAuthErrorRecovery, type AuthErrorRecovery } from '@/utils/errors/auth-error-recovery';

/** The inline error surface payload: a resolved message + an optional recovery action. */
export interface AuthActionRecovery {
  /** Resolved i18n message for the banner (undefined when there's no error). */
  message: string | undefined;
  /** Inline recovery action — present only for RECOVERABLE codes. */
  recovery: AuthErrorRecovery | undefined;
}

// The recovery-aware sibling of useAuthActionError. It narrows
// actionData → resolves BOTH the inline message AND the recovery affordance from
// the SAME code, so an adopting route can render an inline banner + a recovery
// <Link> inside <AuthCeremony>. Like useAuthActionError it fires NO toast — the
// inline-only surface stands (the recovery link is ADDITIVE, not a toast).
export function useAuthActionRecovery(actionData: unknown): AuthActionRecovery {
  const getErrorMessage = useAuthErrorMessage();
  const getRecovery = useAuthErrorRecovery();
  const code = (actionData as { error?: string } | undefined)?.error;
  return { message: getErrorMessage(code), recovery: getRecovery(code) };
}
