// app/resources/sso/sso-action.ts
//
// /sso action business logic: unlink an IdP link or start an IdP intent.
// Extracted from sso.service.ts. Pure-internal decomposition — the
// `runSsoAction` signature + `SsoActionDeps` shape are unchanged and re-exported
// through the sso barrel.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { idpTypeToSlug } from '@/modules/auth/idp-slug';
import { readSessions, mostRecent } from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import { idpReturnUrls } from '@/resources/sso/idp-return-urls';
import type { SsoOutcome } from '@/resources/sso/sso-outcome';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { logAuthEvent } from '@/server/observability';
import { providerErrorCode } from '@/utils/errors/auth-error';
import { z } from 'zod';

// ── Dependency-injection seams ──────────────────────
// Production calls never pass deps. Tests inject provider stubs + an event collector
// directly, avoiding module-level mocking of logAuthEvent.

export interface SsoActionDeps {
  startIdpIntent?: (
    idpId: string,
    urls: { success: string; failure: string }
  ) => Promise<{ authUrl?: string | null | undefined }>;
  onAuthEvent?: (event: string, outcome: 'success' | 'failure') => void;
}

// ── helpers ─────────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

// ── /sso action ─────────────────────────────────────────────────────────────────

const SsoActionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('unlink'),
    idpId: z.string().min(1),
    linkedUserId: z.string().min(1),
    // NOTE: any form `userId` is intentionally NOT read here — the user id comes
    // from the session only (security control).
  }),
  z.object({
    intent: z.literal('start'),
    provider: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]{1,64}$/),
    organization: z.string().optional(),
    linkOnly: z.string().optional(),
  }),
]);

/**
 * /sso action logic (unlink + start intent). CSRF must already be asserted by the route.
 * `form` is the parsed FormData. Returns a typed SsoOutcome the route translates verbatim.
 */
export async function runSsoAction(
  provider: AuthProvider,
  request: Request,
  form: FormData,
  deps: SsoActionDeps = {}
): Promise<SsoOutcome> {
  const parsed = SsoActionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { kind: 'response', response: new Response('Bad Request', { status: 400 }) };
  }
  const payload = parsed.data;

  if (payload.intent === 'unlink') {
    if (!env.ALLOW_IDP_UNLINK) {
      return { kind: 'response', response: new Response(null) }; // route returns null
    }

    const entries = await readSessions(request);
    const recent = mostRecent(entries);
    const session = recent ? await provider.getSession(recent.id, recent.token) : null;
    const userId = session?.user?.id;
    if (!userId) {
      return { kind: 'response', response: new Response(null) }; // never trust a form userId
    }

    // Guard removeIdpLink — on ProviderError return a 502 + failure event.
    try {
      await provider.removeIdpLink(userId, payload.idpId, payload.linkedUserId);
      logAuthEvent('idp.unlink', 'success', {
        userId,
        idpId: payload.idpId,
        linkedUserId: payload.linkedUserId,
      });
    } catch (err) {
      if (err instanceof ProviderError) {
        logAuthEvent('idp.unlink', 'failure', { userId, reason: err.code });
        return { kind: 'data', payload: { error: 'provider_error' }, status: 502 };
      }
      throw err; // unknown → root ErrorBoundary
    }
    return { kind: 'redirect', location: '/sso' };
  }

  // intent === 'start'
  const activeIdPs = await provider.getActiveIdPs(payload.organization || undefined);
  const target = activeIdPs.find(
    (p) => p.id === payload.provider || slugify(p.name) === payload.provider
  );
  if (!target) return { kind: 'redirect', location: '/sso' };

  // P6 Task 9: LDAP-type IdPs use a dedicated credential-entry screen instead of
  // an external IdP redirect. Route to /sso/ldap with the idpId and any flow params.
  if (idpTypeToSlug(target.type) === 'ldap') {
    // Account-linking via LDAP is not yet supported — guard it here so the user
    // gets a clear error rather than a silent plain sign-in.
    // TODO(P7): wire LDAP link via retrieveIdpIntent information + addIdpLink
    if (payload.linkOnly === 'true') {
      return { kind: 'redirect', location: `/sso/ldap/error?reason=ldap-link-unsupported` };
    }

    const qs = new URLSearchParams({ idpId: target.id });
    if (payload.organization) qs.set('organization', payload.organization);
    return { kind: 'redirect', location: `/sso/ldap?${qs.toString()}` };
  }

  const origin = trustedAppOrigin(request);
  const slug = payload.provider;
  const { success, failure } = idpReturnUrls(origin, slug, {
    link: payload.linkOnly === 'true',
    organization: payload.organization || undefined,
  });

  // Guard startIdpIntent — on ProviderError redirect to the SSO error page
  // and emit a failure audit event. DI seam allows tests to stub the call directly.
  const doStartIdpIntent =
    deps.startIdpIntent ??
    ((idpId: string, urls: { success: string; failure: string }) =>
      provider.startIdpIntent(idpId, urls));

  let authUrl: string | null | undefined;
  try {
    const result = await doStartIdpIntent(target.id, { success, failure });
    authUrl = result.authUrl;
  } catch (err) {
    if (err instanceof ProviderError) {
      deps.onAuthEvent?.('idp_start', 'failure');
      logAuthEvent('idp_start', 'failure', { reason: err.code });
      return {
        kind: 'redirect',
        location: `/sso/${encodeURIComponent(slug)}/error?reason=${encodeURIComponent(providerErrorCode(err.code))}`,
      };
    }
    throw err; // unknown → root ErrorBoundary
  }

  if (!authUrl) {
    logAuthEvent('idp_start', 'failure', { reason: 'no_auth_url' });
    return { kind: 'redirect', location: '/sso' };
  }
  return { kind: 'redirect', location: authUrl };
}
