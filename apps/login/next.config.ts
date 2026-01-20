import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { DEFAULT_CSP } from "./constants/csp.js";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */

// Configure frame-ancestors via env to control who can embed this app in an iframe.
// Examples:
//   NEXT_PUBLIC_FRAME_ANCESTORS="'none'"                    → disallow all framing
//   NEXT_PUBLIC_FRAME_ANCESTORS="'self'"                    → only same-origin may frame
//   NEXT_PUBLIC_FRAME_ANCESTORS="'self' https://foo.example" → allow specific origins
const FRAME_ANCESTORS = process.env.NEXT_PUBLIC_FRAME_ANCESTORS || "'none'";

const secureHeaders = (() => {
  const headers = [
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    {
      key: "Referrer-Policy",
      value: "origin-when-cross-origin",
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "X-XSS-Protection",
      value: "1; mode=block",
    },
    {
      key: "Content-Security-Policy",
      value: `${DEFAULT_CSP} frame-ancestors ${FRAME_ANCESTORS}`,
    },
  ];

  // Only add X-Frame-Options when it aligns with the CSP intent.
  // If FRAME_ANCESTORS is more permissive than SAMEORIGIN, omit XFO to avoid conflicts.
  if (FRAME_ANCESTORS.trim() === "'none'") {
    headers.push({ key: "X-Frame-Options", value: "deny" });
  } else if (FRAME_ANCESTORS.trim() === "'self'") {
    headers.push({ key: "X-Frame-Options", value: "SAMEORIGIN" });
  }

  return headers;
})();

const imageRemotePatterns = [
  {
    protocol: "http" as const,
    hostname: "localhost",
    port: "8080",
    pathname: "/**",
  },
  {
    protocol: "https" as const,
    hostname: "*.zitadel.*",
    port: "",
    pathname: "/**",
  },
] satisfies NonNullable<NextConfig["images"]>["remotePatterns"];

if (process.env.ZITADEL_API_URL) {
  imageRemotePatterns.push({
    protocol: "https" as const,
    hostname: process.env.ZITADEL_API_URL?.replace("https://", "") || "",
    port: "",
    pathname: "/**",
  });
}

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  output: process.env.NEXT_OUTPUT_MODE as "standalone" | "export" | undefined,
  reactStrictMode: true, // Recommended for the `pages` directory, default in `app`.
  cacheComponents: true,
  images: {
    remotePatterns: imageRemotePatterns,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: secureHeaders,
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "sentry",

  project: "auth-ui",
  sentryUrl: process.env.NEXT_PUBLIC_SENTRY_URL,

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",


  authToken: process.env.SENTRY_AUTH_TOKEN,
});
