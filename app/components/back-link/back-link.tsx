import { previousStepFor } from './previous-step';
import { Trans } from '@lingui/react/macro';
import { Link, useLocation } from 'react-router';

/**
 * "← Back" control. Resolves the predecessor for the current pathname from the
 * static previousStepFor map and preserves the current query string (so loginName /
 * requestId / organization survive the step-back). Renders nothing when the current
 * step has no predecessor (terminal/headless screens).
 */
export function BackLink() {
  const location = useLocation();
  const target = previousStepFor(location.pathname);
  if (!target) return null;
  const to = location.search ? `${target}${location.search}` : target;
  return (
    <Link to={to} className="text-sm text-gray-600 underline">
      <Trans>← Back</Trans>
    </Link>
  );
}
