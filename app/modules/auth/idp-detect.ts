// Best-effort IdP type inference from a linked account's username.
//
// Why: a linked IdP only carries an explicit `type` when its `idpId` still matches an ACTIVE
// provider (see joinLinkedIdps). A link to a deactivated provider — or one the backend omits
// from the active list — arrives with `type` undefined, so the row falls back to the generic
// mail glyph even when the username is obviously a GitHub handle. This recovers the icon from
// the only signal left: the shape of the username.
//
// Scope: v1 supports Google + GitHub (see idp-slug TYPE_TO_SLUG). Google logins are email
// addresses; GitHub logins are bare handles (alphanumeric + non-leading/trailing hyphens, no
// '@' or '.'). So only GitHub is inferable here — anything email-shaped returns undefined and
// keeps the caller's generic fallback. Always pair as `link.type ?? inferIdpType(...)` so a real
// type wins.

// GitHub username rules: 1–39 chars, alphanumeric or single internal hyphens, no leading/
// trailing or consecutive hyphens. This intentionally rejects emails (the '.'/'@' fail it).
const GITHUB_HANDLE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function inferIdpType(username?: string | null): string | undefined {
  if (!username) return undefined;
  // An all-digit string is almost certainly an opaque provider subject id (e.g. a Google OIDC
  // `sub`), not a GitHub handle — don't mis-badge it as GitHub; fall back to the generic glyph.
  if (/^\d+$/.test(username)) return undefined;
  return GITHUB_HANDLE.test(username) ? 'GITHUB' : undefined;
}
