// app/resources/sso/sso-org.ts
//
// Org precedence for the /sso management screen and its start-link action: an explicit org
// (URL `?organization=` on the loader, the form field on the action) wins; else the org the
// active session was minted under; else undefined so `resolveOrg` applies the default-org
// fallback (env pin → instance Default Organization).
//
// The session rung is what makes a BARE /id/sso link work for portals that sign users in under
// their own org (the staff portal pins its Zitadel org via the OIDC org-id scope, and that org is
// stamped onto the session entry at sign-in). Without it the screen listed the DEFAULT org's IdPs
// and linked the wrong Google provider. The loader and the action MUST resolve the same org —
// the form the loader renders is what the action reads — so both go through this one helper.
import type { SessionEntry } from '@/modules/auth/session/cookie';

export function resolveSsoOrg(
  explicit: string | undefined,
  entry: SessionEntry | undefined
): string | undefined {
  return explicit || entry?.organization || undefined;
}
