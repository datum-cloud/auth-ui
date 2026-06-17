import { Trans } from '@lingui/react/macro';
import { Link } from 'react-router';

interface IdentityBadgeProps {
  loginName: string;
  /** Threaded through "Not you?" so the OIDC/org ceremony continues. loginName is intentionally dropped. */
  requestId?: string;
  organization?: string;
}

/**
 * "Signing in as <loginName> — Not you?" shown on post-identifier steps. "Not you?"
 * returns to /login (navigation only; the multi-account session list is untouched),
 * preserving requestId + organization but clearing loginName so a different account
 * can be entered. Renders nothing without a loginName.
 */
export function IdentityBadge({ loginName, requestId, organization }: IdentityBadgeProps) {
  if (!loginName) return null;
  const params = new URLSearchParams();
  if (requestId) params.set('requestId', requestId);
  if (organization) params.set('organization', organization);
  const qs = params.toString();
  const to = qs ? `/login?${qs}` : '/login';
  return (
    <p className="text-center text-sm text-gray-600">
      <Trans>Signing in as</Trans> <span className="font-medium text-gray-900">{loginName}</span>{' '}
      <Link to={to} className="underline">
        <Trans>Not you?</Trans>
      </Link>
    </p>
  );
}
