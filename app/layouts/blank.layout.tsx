import { ThemeToggle } from '@/components/theme-toggle/theme-toggle';
import type { BrandingTheme } from '@/modules/auth/types';
import { Logo } from '@datum-cloud/datum-ui/logo';
import { cn } from '@datum-cloud/datum-ui/utils';
import { Link } from 'react-router';

export default function BlankLayout({
  children,
  branding,
  className,
}: {
  children: React.ReactNode;
  branding?: BrandingTheme | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-background relative flex min-h-screen w-full flex-col p-3 sm:p-4 md:px-[41px] md:py-8',
        className
      )}>
      <div className="mb-6 flex items-center justify-between">
        <Link to="/">
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt="" aria-hidden="true" className="h-6 w-auto" />
          ) : (
            <Logo.Flat aria-label="Datum" className="h-6 w-auto" tone="brand" />
          )}
        </Link>
        <ThemeToggle />
      </div>
      <main className="flex flex-1 flex-col items-center justify-center">{children}</main>
    </div>
  );
}
