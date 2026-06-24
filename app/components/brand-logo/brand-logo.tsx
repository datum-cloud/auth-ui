import type { BrandingTheme } from '@/modules/auth/types';
import { Logo } from '@datum-cloud/datum-ui/logo';
import { Link } from 'react-router';

// The home-link + logo swap shared by the auth layouts: the org's branding logo when
// present, else the Datum flat mark. Each layout keeps its own wrapper div + className;
// this owns only the <Link> + img/Logo.Flat conditional so the two stay byte-identical.
export function BrandLogo({ branding }: { branding?: BrandingTheme | null }): React.JSX.Element {
  return (
    <Link to="/">
      {branding?.logoUrl ? (
        <img src={branding.logoUrl} alt="" aria-hidden="true" className="h-6 w-auto" />
      ) : (
        <Logo.Flat aria-label="Datum" className="h-6 w-auto" tone="brand" />
      )}
    </Link>
  );
}
