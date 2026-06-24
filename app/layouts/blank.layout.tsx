import { BrandLogo } from '@/components/brand-logo/brand-logo';
import type { BrandingTheme } from '@/modules/auth/types';
import { cn } from '@datum-cloud/datum-ui/utils';

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
        <BrandLogo branding={branding} />
      </div>
      <main className="flex flex-1 flex-col items-center justify-center">{children}</main>
    </div>
  );
}
