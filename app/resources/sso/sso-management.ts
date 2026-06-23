// app/resources/sso/sso-management.ts
//
// /sso loader business logic: list linked/unlinked IdPs for the session user.
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
 * Route view-model for a linked IdP (755-M6). Extends the bare provider `IdpLink`
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
  unlinked: IdProvider[];
  allowUnlink: boolean;
}

/**
 * Join raw IdP links to the active-provider list by `idpId` to attach display metadata
 * ({name, type, logoUrl}) and DEDUPE the linked list by `idpId` (755-M6).
 *
 * Dedupe is defensive: the real duplicate SOURCE is the 755-J2 partial-link residue (a fresh
 * link that errored mid-ceremony could leave two rows for one IdP). First occurrence wins.
 * Exported for unit testing the join + dedupe in isolation from the loader's I/O.
 */
export function joinLinkedIdps(links: IdpLink[], active: IdProvider[]): LinkedIdpView[] {
  const byId = new Map<string, IdProvider>(active.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: LinkedIdpView[] = [];
  for (const link of links) {
    if (seen.has(link.idpId)) continue; // dedupe by idpId — first occurrence wins
    seen.add(link.idpId);
    const provider = byId.get(link.idpId);
    out.push(
      provider
        ? { ...link, name: provider.name, type: provider.type, logoUrl: provider.logoUrl }
        : { ...link }
    );
  }
  return out;
}

export type SsoManagementResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'data'; data: SsoManagementData; setCookie: string | null };

/**
 * /sso loader logic. Lists the active IdPs, resolves the ceremony session (guarding a
 * transient ProviderError into a service_unavailable redirect), and shapes the
 * linked/unlinked split. Returns a redirect to /login when there is no session user.
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

  // listIdpLinks now returns IdpLink[] — no cast needed.
  const links = await provider.listIdpLinks(userId);
  // 755-M6: join links ↔ active IdPs by idpId to attach {name,type,logoUrl} and dedupe.
  const linked = joinLinkedIdps(links, active);
  const linkedIds = new Set(linked.map((l) => l.idpId));

  return {
    kind: 'data',
    data: {
      csrfToken: csrf.token,
      userId,
      loginName: session?.user?.loginName ?? null,
      linked,
      unlinked: active.filter((p) => !linkedIds.has(p.id)),
      allowUnlink: env.ALLOW_IDP_UNLINK,
    },
    setCookie: csrf.setCookie,
  };
}
