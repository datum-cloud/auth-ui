// app/resources/sso/sso-management.ts
//
// /sso loader business logic: list linked IdPs + linkable providers for the session user.
// Extracted from sso.service.ts. Pure-internal decomposition — the
// `resolveSsoManagement` signature + `SsoManagementData`/`SsoManagementResult`
// shapes are unchanged and re-exported through the sso barrel.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { readSessions, mostRecent } from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import type { IdpLink, IdProvider } from '@/modules/auth/types';
import { env } from '@/server/infra/env.server';

// ── /sso loader ─────────────────────────────────────────────────────────────────

/**
 * Route view-model for a linked IdP. Extends the bare provider `IdpLink`
 * ({idpId, idpUserId, idpUserName}) with the display fields joined in from the active-IdP
 * list ({name, type, logoUrl}) so the route can render a provider icon + name instead of a
 * bare UUID. The provider-display fields are optional: a link whose IdP is no longer active
 * (deactivated provider) still renders, just without the badge metadata.
 */
export interface LinkedIdpView extends IdpLink {
  name?: string;
  type?: string;
  logoUrl?: string;
}

export interface SsoManagementData {
  csrfToken: string;
  userId: string;
  loginName: string | null;
  linked: LinkedIdpView[];
  linkable: IdProvider[];
  allowUnlink: boolean;
}

/**
 * Join raw IdP links to the active-provider list by `idpId` to attach display metadata
 * ({name, type, logoUrl}) and DEDUPE the linked list by `idpId`.
 *
 * Dedupe is defensive: the real duplicate SOURCE is the partial-link residue (a fresh
 * link that errored mid-ceremony could leave two rows for one IdP). First occurrence wins.
 * Exported for unit testing the join + dedupe in isolation from the loader's I/O.
 */
export function joinLinkedIdps(
  links: IdpLink[],
  active: IdProvider[],
  perIdentity = false
): LinkedIdpView[] {
  const byId = new Map<string, IdProvider>(active.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: LinkedIdpView[] = [];
  for (const link of links) {
    // perIdentity (multi-identity mode): dedupe on the full identity (idpId:idpUserId) so every
    // distinct identity gets a row while still collapsing partial-link residue (the SAME identity
    // duplicated mid-ceremony). Default (per-provider): dedupe on idpId — legacy one row per IdP.
    const key = perIdentity ? `${link.idpId}:${link.idpUserId}` : link.idpId;
    if (seen.has(key)) continue; // first occurrence wins
    seen.add(key);
    const provider = byId.get(link.idpId);
    out.push(
      provider
        ? { ...link, name: provider.name, type: provider.type, logoUrl: provider.logoUrl }
        : { ...link }
    );
  }
  return out;
}

/**
 * Providers offered in the "link an account" section. With multi-identity linking ON every active
 * provider is offered (you can always add another identity); with it OFF a provider is offered only
 * when no link for it exists yet (legacy one-per-provider).
 */
export function linkableProviders(
  active: IdProvider[],
  linked: LinkedIdpView[],
  allowMulti: boolean
): IdProvider[] {
  if (allowMulti) return [...active];
  const linkedIds = new Set(linked.map((l) => l.idpId));
  return active.filter((p) => !linkedIds.has(p.id));
}

export type SsoManagementResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'data'; data: SsoManagementData; setCookie: string | null };

/**
 * /sso loader logic. Lists the active IdPs, resolves the ceremony session (guarding a
 * transient ProviderError into a service_unavailable redirect), and shapes the
 * linked list + linkable providers (env.ALLOW_IDP_LINK_ANY_EMAIL gates multi-identity:
 * per-identity rows + all providers offered when on; legacy one-per-provider when off).
 * Returns a redirect to /login when there is no session user.
 *
 * `getCsrfToken` is injected so the route can wire the request-scoped CSRF token without
 * the service depending on the server CSRF module directly.
 */
export async function resolveSsoManagement(
  provider: AuthProvider,
  request: Request,
  csrf: { token: string; setCookie: string | null }
): Promise<SsoManagementResult> {
  const url = new URL(request.url);
  const organization = url.searchParams.get('organization') ?? undefined;

  const active = provider.capabilities.externalIdp
    ? await provider.getActiveIdPs(organization)
    : [];

  const entries = await readSessions(request);
  const recent = mostRecent(entries);

  // Guard getSession so a transient ProviderError doesn't produce a raw 500.
  // On any provider failure redirect to /login — the user must re-authenticate.
  let session: Awaited<ReturnType<typeof provider.getSession>> | null;
  try {
    session = recent ? await provider.getSession(recent.id, recent.token) : null;
  } catch (err) {
    if (err instanceof ProviderError) {
      return { kind: 'redirect', location: '/error?code=service_unavailable' };
    }
    throw err; // unknown → root ErrorBoundary
  }
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return { kind: 'redirect', location: '/login' };
  }

  const allowMulti = env.ALLOW_IDP_LINK_ANY_EMAIL;
  const links = await provider.listIdpLinks(userId);
  // Join links ↔ active IdPs; per-identity rows when multi-identity linking is on.
  const linked = joinLinkedIdps(links, active, allowMulti);

  return {
    kind: 'data',
    data: {
      csrfToken: csrf.token,
      userId,
      loginName: session?.user?.loginName ?? null,
      linked,
      // Multi on → offer every provider (add another); off → only providers with no link yet.
      linkable: linkableProviders(active, linked, allowMulti),
      allowUnlink: env.ALLOW_IDP_UNLINK,
    },
    setCookie: csrf.setCookie,
  };
}
