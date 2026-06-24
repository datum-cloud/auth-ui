import { assetUrl } from '@/utils/asset-url';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { MailIcon } from 'lucide-react';

/**
 * Provider icon/avatar for an IdP-linked account or connection.
 *
 * Resolution order: known-type bundled image (Google/GitHub) → provider `logoUrl`
 * → generic mail glyph. Decorative only (`aria-hidden`) so it never contributes an
 * accessible name inside an enclosing interactive control — avoids the
 * nested-interactive axe violation when rendered inside the account-switch button
 * or the SSO unlink row. Shared by /id/sso and /id/accounts.
 */
export function IdpIcon({
  type,
  name,
  logoUrl,
}: {
  type?: string;
  name?: string;
  logoUrl?: string;
}) {
  const t = (type ?? '').toUpperCase();
  if (t === 'GOOGLE') {
    return (
      <img
        src={assetUrl(`/images/idps/google.png`)}
        alt="Google"
        aria-hidden
        width={20}
        height={20}
        className="shrink-0 rounded"
      />
    );
  }
  if (t === 'GITHUB' || t === 'GITHUB_ES') {
    return (
      <img
        src={assetUrl(`/images/idps/github.png`)}
        alt="GitHub"
        aria-hidden
        width={20}
        height={20}
        className="shrink-0 rounded"
      />
    );
  }
  if (logoUrl) {
    return (
      <img src={logoUrl} alt="" aria-hidden width={20} height={20} className="shrink-0 rounded" />
    );
  }

  return (
    <span
      aria-hidden
      aria-label={name ?? 'Datum'}
      className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded">
      <Icon icon={MailIcon} size={16} />
    </span>
  );
}
