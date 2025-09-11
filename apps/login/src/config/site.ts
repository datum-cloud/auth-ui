export const SITE_CONFIG = {
  siteTitle: "Datum",
  siteDescription:
    "Thanks for being part of the Datum community. Feedback welcome!",
  siteUrl: "https://cloud.datum.net",
  siteImage: "/images/logo.svg",
  favicon: "/favicon.ico",
  address: "",
} as const;

export const ROUTE_METADATA = {
  // Main routes
  home: "Home",

  // Authentication routes
  login: "Sign In",
  register: "Create Account",
  logout: "Sign Out",

  // Account management
  accounts: "Account Selection",
  password: "Password",

  // Multi-factor authentication
  mfa: "Multi-Factor Authentication",
  otp: "One-Time Password",
  u2f: "Security Key",
  passkey: "Passkey",
  authenticator: "Authenticator App",

  // Identity providers
  idp: "External Sign In",

  // Device and verification
  device: "Device Authorization",
  verify: "Verification",
  signedin: "Signed In",

  // SAML
  "saml-post": "SAML Authentication",
} as const;

export type RouteKey = keyof typeof ROUTE_METADATA;
