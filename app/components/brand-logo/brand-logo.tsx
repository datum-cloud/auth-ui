import { ThemedImage } from '@/components/themed-image/themed-image';
import type { BrandingTheme } from '@/modules/auth/types';
import { ThemedLogo } from '@datum-cloud/datum-ui/logo/themed';
import { Link } from 'react-router';

// The home-link + logo swap shared by the auth layouts: the org's branding logo when
// present, else the Datum mark. Each layout keeps its own wrapper div + className;
// this owns only the <Link> + logo conditional so the two stay byte-identical.
//
// Both branches are theme-aware:
//   - org logo → <ThemedImage>: branding.darkLogoUrl (from Zitadel's darkTheme) on dark,
//     falling back to logoUrl when no dark variant is configured.
//   - Datum mark → <ThemedLogo.Flat>: datum-ui resolves `brand` on light / `mono-light`
//     on dark via useTheme (SSR-safe, brand fallback before hydration).
export function BrandLogo({ branding }: { branding?: BrandingTheme | null }): React.JSX.Element {
  return (
    // When an org logo is shown the image is decorative (aria-hidden), so the link needs its own
    // accessible name; the Datum fallback gets its name from <ThemedLogo.Flat aria-label="Datum">.
    <Link to="/" aria-label={branding?.logoUrl ? 'Home' : undefined}>
      {branding?.logoUrl ? (
        <ThemedImage
          light={branding.logoUrl}
          dark={branding.darkLogoUrl}
          alt=""
          aria-hidden="true"
          className="h-6 w-auto"
        />
      ) : (
        <ThemedLogo.Flat aria-label="Datum" className="h-6 w-auto" />
      )}
    </Link>
  );
}
