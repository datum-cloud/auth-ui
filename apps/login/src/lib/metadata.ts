import { ROUTE_METADATA, RouteKey, SITE_CONFIG } from "@/config/site";
import { Metadata } from "next";

interface GenerateMetadataOptions {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
}

/**
 * Generate metadata for a page with consistent title format: "Datum - {pageTitle}"
 */
export function generateMetadata(
  options: GenerateMetadataOptions = {},
): Metadata {
  const {
    title,
    description = SITE_CONFIG.siteDescription,
    path = "",
    image = SITE_CONFIG.siteImage,
    noIndex = false,
  } = options;

  const pageTitle = title
    ? `${SITE_CONFIG.siteTitle} - ${title}`
    : SITE_CONFIG.siteTitle;
  const url = `${SITE_CONFIG.siteUrl}${path}`;

  return {
    title: pageTitle,
    description,
    openGraph: {
      title: pageTitle,
      description,
      url,
      siteName: SITE_CONFIG.siteTitle,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: SITE_CONFIG.siteTitle,
        },
      ],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
      images: [image],
    },
    robots: {
      index: !noIndex,
      follow: !noIndex,
    },
    alternates: {
      canonical: url,
    },
  };
}

/**
 * Generate metadata from route configuration
 */
export function generateRouteMetadata(
  route: RouteKey,
  overrides: Partial<GenerateMetadataOptions> = {},
): Metadata {
  const routeTitle = ROUTE_METADATA[route];
  const routePath = route === "home" ? "/" : `/${route}`;

  return generateMetadata({
    title: routeTitle,
    path: routePath,
    ...overrides,
  });
}

/**
 * Get route title from configuration
 */
export function getRouteTitle(route: RouteKey): string {
  return ROUTE_METADATA[route];
}
