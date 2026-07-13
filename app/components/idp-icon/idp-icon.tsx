import { ThemedImage } from '@/components/themed-image/themed-image';
import { assetUrl, darkAssetUrl } from '@/utils/asset-url';
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
 *
 * Bundled marks pass a `dark` source via the `.dark` suffix convention: it's optimistic, so
 * `<provider>.dark.png` auto-activates when it ships and falls back to the light mark until then.
 */
export function IdpIcon({
  type,
  logoUrl,
}: {
  type?: string;
  /** Accepted for call-site symmetry; the icon is decorative (aria-hidden) so it isn't rendered. */
  name?: string;
  logoUrl?: string;
}) {
  const t = (type ?? '').toUpperCase();
  if (t === 'GOOGLE') {
    return (
      <ThemedImage
        light={assetUrl(`/images/idps/google.png`)}
        dark={darkAssetUrl(`/images/idps/google.png`)}
        alt=""
        aria-hidden
        width={20}
        height={20}
        className="shrink-0 rounded"
      />
    );
  }
  if (t === 'GITHUB' || t === 'GITHUB_ES') {
    return (
      <ThemedImage
        light={assetUrl(`/images/idps/github.png`)}
        dark={darkAssetUrl(`/images/idps/github.png`)}
        alt=""
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
      className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded">
      <Icon icon={MailIcon} size={16} />
    </span>
  );
}
