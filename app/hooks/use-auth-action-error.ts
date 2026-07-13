import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';

// Collapses the repeated pipeline (narrow actionData → resolve message → return
// for inline render). The unknown→{error?} cast lives HERE only; tightening action
// return types later removes the cast with zero call-site churn.
// Inline-error redesign: the hook NO LONGER fires a toast — the inline
// <FormError> in <AuthCeremony error={…}> is the sole error surface across the
// login/signup/setup/sso routes (inline instead of toast).
export function useAuthActionError(actionData: unknown): string | undefined {
  const getErrorMessage = useAuthErrorMessage();
  const code = (actionData as { error?: string } | undefined)?.error;
  return getErrorMessage(code);
}
