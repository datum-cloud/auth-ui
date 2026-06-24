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
export function useAuthActionRecovery(
  actionData: unknown,
  ctx?: { requestId?: string; organization?: string }
): AuthActionRecovery {
  const getErrorMessage = useAuthErrorMessage();
  // Forward the in-scope OIDC ceremony context so the recovery <Link> preserves
  // requestId/organization (mid-OIDC users return to the relying party, not the
  // default post-login redirect). undefined ctx → bare /login (non-OIDC flows).
  const getRecovery = useAuthErrorRecovery(ctx);
  const code = (actionData as { error?: string } | undefined)?.error;
  return { message: getErrorMessage(code), recovery: getRecovery(code) };
}
