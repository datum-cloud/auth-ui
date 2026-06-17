import { Logo } from '@datum-cloud/datum-ui/logo';
import { cn } from '@datum-cloud/datum-ui/utils';

export default function BlankLayout({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-background relative flex min-h-screen w-full flex-col p-3 sm:p-4 md:px-[41px] md:py-8',
        className
      )}>
      <div className="justify-flex-start mb-6 flex items-center">
        <Logo.Flat aria-label="Datum" className="h-6 w-auto" tone="brand" />
      </div>
      {children}
    </div>
  );
}
