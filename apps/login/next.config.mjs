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
    protocol: "http",
    hostname: "localhost",
    port: "8080",
    pathname: "/**",
  },
  {
    protocol: "https",
    hostname: "*.zitadel.*",
    port: "",
    pathname: "/**",
  },
];

if (process.env.ZITADEL_API_URL) {
  imageRemotePatterns.push({
    protocol: "https",
    hostname: process.env.ZITADEL_API_URL?.replace("https://", "") || "",
    port: "",
    pathname: "/**",
  });
}

const nextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  output: process.env.NEXT_OUTPUT_MODE || undefined,
  reactStrictMode: true, // Recommended for the `pages` directory, default in `app`.
  experimental: {
    dynamicIO: true,
  },
  images: {
    remotePatterns: imageRemotePatterns,
  },
  eslint: {
    ignoreDuringBuilds: true,
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

export default withNextIntl(nextConfig);
