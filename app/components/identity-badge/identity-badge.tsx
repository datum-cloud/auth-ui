import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface IdentityBadgeProps {
  loginName: string;
  /** Threaded through the link so the OIDC/org ceremony continues. loginName is intentionally dropped. */
  requestId?: string;
  organization?: string;
  /** Text before the bolded loginName. Default: "Signing in as". */
  verb?: ReactNode;
  /** Text of the trailing link. Default: "Not you?". Ignored when showLink is false. */
  linkLabel?: ReactNode;
  /** Explicit link target. Default: /login (+ requestId/organization qs, loginName dropped). */
  linkTarget?: string;
  /** Set false to render identity context with no link at all. Default: true. */
  showLink?: boolean;
}

/**
 * "<verb> <loginName> — <linkLabel>" shown on post-identifier steps. The link
 * (when shown) preserves requestId + organization but clears loginName so a
 * different account can be entered/switched to. Renders nothing without a loginName.
 */
export function IdentityBadge({
  loginName,
  requestId,
  organization,
  verb = <Trans>Signing in as</Trans>,
  linkLabel = <Trans>Not you?</Trans>,
  linkTarget,
  showLink = true,
}: IdentityBadgeProps) {
  if (!loginName) return null;
  if (!showLink) {
    return (
      <p className="text-foreground text-center text-sm">
        {verb} <strong>{loginName}</strong>
      </p>
    );
  }
  const params = new URLSearchParams();
  if (requestId) params.set('requestId', requestId);
  if (organization) params.set('organization', organization);
  const qs = params.toString();
  const to = linkTarget ?? (qs ? `/login?${qs}` : '/login');
  return (
    <p className="text-foreground text-center text-sm">
      {verb} <strong>{loginName}</strong>.{' '}
      <Link to={to} className="underline">
        {linkLabel}
      </Link>
    </p>
  );
}
