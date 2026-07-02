// import { ThemedImage } from '@/components/themed-image/themed-image';
import type { BrandingTheme } from '@/modules/auth/types';
import { ThemedLogo } from '@datum-cloud/datum-ui/logo/themed';
import { Link } from 'react-router';

// TEMP — hardcoded to the datum-ui Datum mark, ignoring org branding.
// The original per-org branding-logo swap is preserved (commented) below; restore it
// (and the ThemedImage import above) to bring org logos from Zitadel branding back.
//
// The Datum mark is theme-aware: <ThemedLogo.Flat> resolves `brand` on light /
// `mono-light` on dark via useTheme (SSR-safe, brand fallback before hydration), and
// names the home link itself via aria-label="Datum".
export function BrandLogo(_props: { branding?: BrandingTheme | null }): React.JSX.Element {
  return (
    <Link to="/">
      <ThemedLogo.Flat aria-label="Datum" className="h-6 w-auto" />
    </Link>
  );

  // ── Original: org branding logo when present, else the Datum mark ──
  // Both branches are theme-aware:
  //   - org logo → <ThemedImage>: branding.darkLogoUrl (from Zitadel's darkTheme) on dark,
  //     falling back to logoUrl when no dark variant is configured.
  //   - Datum mark → <ThemedLogo.Flat>: datum-ui resolves `brand` on light / `mono-light` on dark.
  //
  // return (
  //   // When an org logo is shown the image is decorative (aria-hidden), so the link needs its own
  //   // accessible name; the Datum fallback gets its name from <ThemedLogo.Flat aria-label="Datum">.
  //   <Link to="/" aria-label={branding?.logoUrl ? 'Home' : undefined}>
  //     {branding?.logoUrl ? (
  //       <ThemedImage
  //         light={branding.logoUrl}
  //         dark={branding.darkLogoUrl}
  //         alt=""
  //         aria-hidden="true"
  //         className="h-6 w-auto"
  //       />
  //     ) : (
  //       <ThemedLogo.Flat aria-label="Datum" className="h-6 w-auto" />
  //     )}
  //   </Link>
  // );
}
