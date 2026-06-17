import { Card, CardContent, CardHeader, CardDescription } from '@datum-cloud/datum-ui/card';
import { Logo } from '@datum-cloud/datum-ui/logo';
import type { ReactNode } from 'react';

interface AuthCardProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

/**
 * Centered card shell shared by every auth screen.
 *
 * Renders the Datum logo, a title, an optional description, and the
 * form content as children.  Max-width is ~sm (384px), centered
 * vertically and horizontally with min-h-screen.
 */
export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center gap-4 pt-6 pb-2">
          <Logo.Flat decorative className="h-7 w-auto" />
          {/* Use <h1> directly: datum-ui CardTitle renders as <div>, which would fail
              axe's page-has-heading-one rule. The h1 carries CardTitle's visual styling. */}
          <h1 className="text-center text-xl font-semibold">{title}</h1>
          {description ? (
            <CardDescription className="text-center">{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="pt-2 pb-6">{children}</CardContent>
      </Card>
    </main>
  );
}
