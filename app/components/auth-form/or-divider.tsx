import { Trans } from '@lingui/react/macro';

// The "or" separator shown between the IdP buttons and the email/password entry on
// /login and /signup. Decorative (aria-hidden) — the surrounding forms carry the
// accessible labels.
export function OrDivider(): React.JSX.Element {
  return (
    <div className="relative my-8 flex items-center" aria-hidden="true">
      <div className="border-border flex-grow border-t" />
      <span className="text-foreground/60 mx-3 shrink-0 text-xs">
        <Trans>or</Trans>
      </span>
      <div className="border-border flex-grow border-t" />
    </div>
  );
}
