import type { MiddlewareHandler } from 'hono';
import { secureHeaders, NONCE } from 'hono/secure-headers';

export function appSecureHeaders(isDev: boolean): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: isDev
        ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
        : ["'self'", NONCE, "'strict-dynamic'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...(isDev ? ['ws:'] : [])],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
    },
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
