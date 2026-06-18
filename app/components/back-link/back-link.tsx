import { previousStepFor } from './previous-step';
import { LinkButton } from '@datum-cloud/datum-ui/button';
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
    <LinkButton
      theme="link"
      type="quaternary"
      as={Link}
      href={to}
      className="mx-auto flex flex-col">
      <Trans>Back</Trans>
    </LinkButton>
  );
}
