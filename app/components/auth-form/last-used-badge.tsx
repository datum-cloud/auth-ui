import { Badge } from '@datum-cloud/datum-ui/badge';
import { Trans } from '@lingui/react/macro';

// The 'Last used' badge, previously inlined 3× in login/index.tsx. The Badge props,
// className, and <Trans> children are copied verbatim from those inline usages so the
// rendered output is byte-identical when this component is adopted.
export function LastUsedBadge({ active }: { active: boolean }): React.JSX.Element | null {
  if (!active) return null;
  return (
    <Badge
      type="primary"
      theme="solid"
      className="absolute -top-3.5 -right-5 rounded-lg text-xs text-white dark:text-[#0c1d31]">
      <Trans>Last used</Trans>
    </Badge>
  );
}
