// /reauth/:provider/error — thin error screen for a failed idp-reauth round-trip.
// Mirrors sso/provider/error.tsx's structure exactly; the only difference is the
// "back" target (the reauth chooser, not /login) and the copy (reauth, not sign-in).
import { AuthCard } from '@/components/auth-card/auth-card';
import { paths } from '@/routes/paths';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { Link, useParams, useSearchParams } from 'react-router';

export function meta() {
  return [{ title: "Couldn't verify" }];
}

// Same reason vocabulary/copy as sso/provider/error.tsx's REASONS map (reuses its i18n
// keys) — only the two reasons the reauth-idp round-trip can actually produce.
const REASONS: Record<string, React.ReactNode> = {
  'access-denied': <Trans>That identity belongs to a different account.</Trans>,
  'context-missing': <Trans>The sign-in link was incomplete or expired.</Trans>,
};

export default function ReauthProviderError() {
  const { provider } = useParams();
  const [sp] = useSearchParams();
  const returnTo = sp.get('returnTo') ?? undefined;
  const reason = sp.get('reason') ?? '';
  const message = REASONS[reason] ?? (
    <Trans>
      Something went wrong with <strong>{provider}</strong>.
    </Trans>
  );
  return (
    <AuthCard title={<Trans>Couldn't verify</Trans>} description={message}>
      <LinkButton
        theme="link"
        type="quaternary"
        className="mt-4"
        as={Link}
        href={paths.reauth({ returnTo })}>
        <Trans>Back to sign in</Trans>
      </LinkButton>
    </AuthCard>
  );
}
