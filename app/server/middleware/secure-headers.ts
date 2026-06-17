import type { MiddlewareHandler } from 'hono';
import { secureHeaders, NONCE } from 'hono/secure-headers';

/**
 * Pure CSP directive builder — extracted so the policy is unit-testable without
 * standing up the Hono middleware. Returned object is passed verbatim as
 * `secureHeaders({ contentSecurityPolicy: cspDirectives(isDev) })`.
 */
export function cspDirectives(isDev: boolean) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: isDev
      ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
      : ["'self'", NONCE, "'strict-dynamic'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    // Fathom analytics beacons POST to https://cdn.usefathom.com — without this
    // connect-src entry the browser blocks them. script-src needs no change:
    // 'strict-dynamic' already trusts scripts injected by our nonce'd bundle.
    connectSrc: ["'self'", 'https://cdn.usefathom.com', ...(isDev ? ['ws:'] : [])],
    // Feature-0 decision (INTENTIONAL, do not make configurable): the auth UI is
    // never embeddable, so frame-ancestors stays hardcoded 'none' (paired with
    // X-Frame-Options: DENY below). The old Next.js app's NEXT_PUBLIC_FRAME_ANCESTORS
    // env knob was deliberately NOT ported — a secure default beats a footgun.
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
  };
}

export function appSecureHeaders(isDev: boolean): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: cspDirectives(isDev),
    strictTransportSecurity: isDev ? false : 'max-age=63072000; includeSubDomains; preload',
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    // P7 Task 8: tightened from origin-when-cross-origin (P0 review work item) —
    // never leak path/query to other origins; same-origin keeps the full URL.
    referrerPolicy: 'strict-origin-when-cross-origin',
    // P7 Task 8 (P0 carry-over): deny powerful features the auth UI never uses.
    // publickey-credentials-get stays self — WebAuthn ceremonies need it.
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
      usb: [],
      publickeyCredentialsGet: ['self'],
    },
  });
}
