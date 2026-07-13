import type { BrandingTheme } from '@/modules/auth/types';
import type { CSSProperties } from 'react';

/**
 * Maps an org's BrandingTheme to inline CSS custom properties for the AuthCard
 * subtree. datum-ui is shadcn-style: components read `var(--primary)` / `var(--background)`,
 * so overriding those vars on a wrapper re-themes everything inside it. Returns an
 * empty object when branding (or the relevant field) is absent — the card then falls
 * back to the datum defaults. Pure (no I/O) so it is unit-tested directly.
 *
 * Note: logoUrl/darkLogoUrl are NOT CSS vars — the AuthCard renders the logo image
 * separately; this helper only covers color tokens.
 */
export function brandingToStyle(branding?: BrandingTheme | null): CSSProperties {
  const vars: Record<string, string> = {};
  if (branding?.primaryColor) vars['--primary'] = branding.primaryColor;
  if (branding?.backgroundColor) vars['--background'] = branding.backgroundColor;
  return vars as CSSProperties;
}
