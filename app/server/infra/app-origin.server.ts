// env is read via its canonical path @/server/infra/env.server: unit tests mock that path to
// inject PUBLIC_ORIGIN, and reading the same path here keeps trustedAppOrigin's host-header
// guard tests honest. (env's physical home is server/infra.)
import { env } from '@/server/infra/env.server';

/**
 * Resolves the trusted origin (scheme + host) for app-built absolute links —
 * notably the verification-email link template (see flows/verify-url-template.ts).
 *
 * SECURITY: the verification link MUST NOT be derived from the request `Host`
 * header, which is client-controllable. An attacker could POST a victim's email
 * with `Host: attacker.com` and have the provider mail the victim a verification
 * link pointing at the attacker's host, leaking the real code + userId. We instead
 * source the origin from trusted config (`PUBLIC_ORIGIN`), which is required in
 * production (AUTH_PROVIDER=zitadel) — boot fails closed if it is unset there.
 *
 * The request-origin fallback only applies in dev/test/fake, where `PUBLIC_ORIGIN`
 * is intentionally optional. `publicOrigin` is injectable purely so unit tests can
 * exercise both branches without mutating module-level env.
 */
export function trustedAppOrigin(
  request: Request,
  publicOrigin: string | undefined = env.PUBLIC_ORIGIN
): string {
  return publicOrigin ?? new URL(request.url).origin;
}
