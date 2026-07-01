// app/resources/sso/sso-link.ts
//
// /sso/link loader business logic: session-gated link-intent start.
// Extracted from sso.service.ts. Pure-internal decomposition — the
// `resolveSsoLink` signature + `SsoLinkResult`/`SsoLinkSignInRequired` shapes are
// unchanged and re-exported through the sso barrel.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { slugToProvider } from '@/modules/auth/idp-slug';
import { readSessions, mostRecent } from '@/modules/auth/session/cookie';
import type { IdProvider } from '@/modules/auth/types';
import { getActiveIdPs } from '@/resources/sso/idp-providers';
import { idpReturnUrls } from '@/resources/sso/idp-return-urls';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { logAuthEvent } from '@/server/observability';

// ── returnTo same-origin allowlist ───────────────────────────────────────────
//
// The /sso/link sign-in-required prompt links the user to /login?returnTo=<x>. If `x`
// were attacker-controlled it would be an open-redirect (phishing pivot). We validate it
// against a SAME-ORIGIN allowlist: a same-origin relative path or absolute URL is reduced
// to its path+search; anything cross-origin, protocol-relative, backslash-obfuscated, or a
// non-http(s) scheme (e.g. javascript:) is rejected to a safe in-app default. The trusted
// origin comes from the app-origin helper (server/infra), never the request Host.

const SAFE_RETURN_TO_DEFAULT = '/';

/**
 * Returns `candidate` only if it resolves to the SAME origin as `appOrigin`, reduced to a
 * path+search relative URL; otherwise the safe in-app default. Rejects cross-origin,
 * protocol-relative (`//host`), backslash-obfuscated authorities (`/\\host`), and non-http(s)
 * schemes. Behavior-preserving for the legitimate case (an in-app relative path).
 */
export function safeSameOriginReturnTo(candidate: string | undefined, appOrigin: string): string {
  if (!candidate) return SAFE_RETURN_TO_DEFAULT;
  // Reject protocol-relative and backslash-obfuscated authorities outright: a leading `//`
  // or `/\` (or `\/`) is parsed by browsers as `//host`, escaping same-origin.
  const normalizedHead = candidate.slice(0, 2).replace(/\\/g, '/');
  if (normalizedHead === '//') return SAFE_RETURN_TO_DEFAULT;
  try {
    // Resolve against the trusted origin: a relative path stays same-origin; an absolute URL
    // keeps its own origin, which the check below rejects unless it equals appOrigin.
    const resolved = new URL(candidate, appOrigin);
    if (resolved.origin !== appOrigin) return SAFE_RETURN_TO_DEFAULT;
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return SAFE_RETURN_TO_DEFAULT;
    }
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    // Unparseable (e.g. `javascript:alert(1)` without a same-origin base) → safe default.
    return SAFE_RETURN_TO_DEFAULT;
  }
}

// ── /sso/link loader ──────────────────────────────────────────────────────────────

export interface SsoLinkSignInRequired {
  mode: 'sign-in-required';
  providers: IdProvider[];
  returnTo: string;
}

export type SsoLinkResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'data'; data: SsoLinkSignInRequired };

/**
 * /sso/link loader logic. Session-gated: no session → render the sign-in-required prompt;
 * session but no specific provider → redirect to /sso; session + provider → start a link
 * intent and redirect to the IdP (or back to /sso on miss / empty authUrl).
 */
export async function resolveSsoLink(
  provider: AuthProvider,
  request: Request
): Promise<SsoLinkResult> {
  const url = new URL(request.url);
  const wantedSlug = url.searchParams.get('provider');
  const organization = url.searchParams.get('organization') ?? undefined;

  const entries = await readSessions(request);
  const recent = mostRecent(entries);
  const session = recent ? await provider.getSession(recent.id, recent.token) : null;

  // (c) No session → render sign-in-required prompt
  if (!session?.user?.id) {
    // Org-first / default-org fallback via the shared choke point: entering /sso/link with no
    // `?organization=` now renders the org's IdPs (default org) instead of the INSTANCE/default set.
    const active = await getActiveIdPs(provider, organization);
    // Validate returnTo against the same-origin allowlist before it reaches the prompt
    // (defense-in-depth: today it is the request's own path, but pinning it here closes the
    // open-redirect class regardless of how the value is sourced).
    const returnTo = safeSameOriginReturnTo(url.pathname + url.search, trustedAppOrigin(request));
    return {
      kind: 'data',
      data: {
        mode: 'sign-in-required',
        providers: active,
        returnTo,
      },
    };
  }

  // (b) Session, no provider → redirect to /sso management screen
  if (!wantedSlug) {
    return { kind: 'redirect', location: '/sso' };
  }

  // (a) Session + specific provider → start link intent and redirect
  // Org-first / default-org fallback via the shared choke point (same as the no-session branch):
  // the linkable providers must come from the org's IdPs, not the INSTANCE/default set.
  const active = await getActiveIdPs(provider, organization);
  const target = slugToProvider(wantedSlug, active);
  if (!target) {
    return { kind: 'redirect', location: '/sso' };
  }

  const origin = trustedAppOrigin(request);
  const { success, failure } = idpReturnUrls(origin, wantedSlug, { link: true, organization });
  const { authUrl } = await provider.startIdpIntent(target.id, { success, failure });

  logAuthEvent('idp.link.start', authUrl ? 'success' : 'failure', {
    idpId: target.id,
    userId: session.user.id,
    slug: wantedSlug,
  });

  return { kind: 'redirect', location: authUrl ? authUrl : '/sso' };
}
