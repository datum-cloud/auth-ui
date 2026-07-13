import { CSRF_FORM_KEY } from '@/shared';

// The single source for the csrf hidden input. Components may import @/shared
// (never @/server), so CSRF_FORM_KEY is sourced from the kernel.
export function CsrfInput({ token }: { token: string }): React.JSX.Element {
  return <input type="hidden" name={CSRF_FORM_KEY} value={token} />;
}
