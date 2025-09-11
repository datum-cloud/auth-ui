import "@/styles/globals.scss";

import { DefaultTags } from "@/components/default-tags";
import { LanguageProvider } from "@/components/language-provider";
import { Loader } from "@/components/loader";
import { ThemeProvider } from "@/components/theme-provider";
import { SITE_CONFIG } from "@/config/site";
import { alliance, canelaText, frontliner } from "@/lib/fonts/fonts";
import { generateMetadata } from "@/lib/metadata";
import { Analytics } from "@vercel/analytics/react";
import { ReactNode, Suspense } from "react";

export const metadata = generateMetadata({
  title: "Authentication",
  description: SITE_CONFIG.siteDescription,
});

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      className={`${alliance.variable} ${canelaText.variable} ${frontliner.variable}`}
      suppressHydrationWarning
    >
      <head>
        <DefaultTags />
      </head>
      <body className="bg-cream dark:bg-dark-navy-blue font-alliance text-navy">
        <ThemeProvider>
          <Suspense fallback={<Loader />}>
            <LanguageProvider>
              <div className="flex min-h-screen w-full items-center justify-center">
                {children}
              </div>
            </LanguageProvider>
          </Suspense>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
