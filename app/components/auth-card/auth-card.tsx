import BlankLayout from '@/layouts/blank.layout';
import type { BrandingTheme } from '@/modules/auth/types';
import { Card, CardContent, CardHeader, CardDescription } from '@datum-cloud/datum-ui/card';
import { cn } from '@datum-cloud/datum-ui/utils';
import type { ReactNode } from 'react';

interface AuthCardProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /**
   * Optional org branding, forwarded to BrandLogo only. It does NOT theme the card:
   * auth pages always render in Datum's own colours and with the Datum mark (BrandLogo
   * ignores org logos for now), so an org's primaryColor never overrides --primary.
   */
  branding?: BrandingTheme | null;

  className?: string;
}

/**
 * Centered card shell shared by every auth screen.
 *
 * Renders the Datum logo, a title, an optional description, and the
 * form content as children.  Max-width is ~sm (384px), centered
 * vertically and horizontally with min-h-screen.
 */
export function AuthCard({ title, description, children, branding, className }: AuthCardProps) {
  return (
    <BlankLayout branding={branding}>
      <Card className={cn('w-full max-w-[410px] gap-3 p-8 md:p-11', className)}>
        <CardHeader className="items-center gap-3 p-0">
          {/* Use <h1> directly: datum-ui CardTitle renders as <div>, which would fail
              axe's page-has-heading-one rule. The h1 carries CardTitle's visual styling. */}
          <h1 className="text-center text-2xl font-semibold">{title}</h1>
          {description && (
            <CardDescription className="text-foreground/80 text-center text-sm">
              {description}
            </CardDescription>
          )}
        </CardHeader>
        {children && (
          <CardContent className="flex w-full flex-col items-center justify-center p-0 *:w-full">
            {children}
          </CardContent>
        )}
      </Card>
    </BlankLayout>
  );
}
