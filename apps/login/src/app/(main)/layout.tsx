import "@/styles/globals.scss";

import scene1 from "@/components/assets/scene-1.svg";
import scene2 from "@/components/assets/scene-2.svg";
import { DefaultTags } from "@/components/default-tags";
import { FathomAnalytics } from "@/components/fathom/fathom";
import { LanguageProvider } from "@/components/language-provider";
import { Loader } from "@/components/loader";
import MarkerIoEmbed from "@/components/markerio/markerio";
import { ThemeProvider } from "@/components/theme-provider";
import { SITE_CONFIG } from "@/config/site";
import { alliance, canelaText, frontliner } from "@/lib/fonts/fonts";
import { generateMetadata } from "@/lib/metadata";
import Image from "next/image";
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
      <body className="bg-body-background font-alliance text-body-foreground relative">
        <div className="fixed bottom-0 left-0 z-0 max-w-[300px] md:max-w-[416px]">
          <Image
            src={scene1}
            className="size-auto w-full object-cover"
            alt="scene 1"
            width={416}
            height={416}
          />
        </div>

        <div className="fixed right-0 bottom-0 z-0 max-w-[500px] md:max-w-[800px]">
          <Image
            src={scene2}
            className="size-auto w-full object-cover"
            alt="scene 2"
            width={800}
            height={800}
          />
        </div>

        <ThemeProvider>
          <Suspense fallback={<Loader />}>
            <LanguageProvider>
              <div className="flex min-h-screen w-full justify-center">
                {children}
              </div>
            </LanguageProvider>
          </Suspense>
        </ThemeProvider>
        <FathomAnalytics />

        {process.env.MARKER_IO_PROJECT_ID && (
          <MarkerIoEmbed projectId={process.env.MARKER_IO_PROJECT_ID} />
        )}
      </body>
    </html>
  );
}
