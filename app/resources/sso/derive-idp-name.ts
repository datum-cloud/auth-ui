// Derive a Zitadel-valid given/family name from an IdP draft.
//
// Some IdPs (notably GitHub) return NO givenName/familyName — often no name at all,
// only the account login. Sending empty firstName/lastName to addHumanUser makes
// Zitadel reject the register: `invalid SetHumanProfile.GivenName: value length must
// be between 1 and 200 runes`. This helper reproduces the old login app's fallback
// chain so the register always carries non-empty profile names.

export interface DeriveIdpProfileNameInput {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  idpUserName?: string;
}

export interface DeriveIdpProfileNameResult {
  firstName: string;
  lastName: string;
}

const MAX_NAME_RUNES = 200;

// Trim, treat whitespace-only as empty, and cap at the Zitadel profile-field limit.
const clean = (value: string | undefined): string => (value ?? '').trim().slice(0, MAX_NAME_RUNES);

/**
 * Compute a non-empty { firstName, lastName } from an IdP draft, mirroring the old app:
 *   1. start with the IdP-provided given/family,
 *   2. if EITHER is empty AND a displayName is present, derive both by splitting the
 *      displayName on whitespace (first token → given, the rest → family),
 *   3. if givenName is still empty → fall back to idpUserName (or "user"),
 *   4. if familyName is still empty → fall back to idpUserName (or "user").
 * Every output is trimmed (whitespace-only treated as empty) and capped at 200 runes.
 */
export function deriveIdpProfileName({
  firstName,
  lastName,
  displayName,
  idpUserName,
}: DeriveIdpProfileNameInput): DeriveIdpProfileNameResult {
  let given = clean(firstName);
  let family = clean(lastName);

  // Step 2: derive from displayName only when something is still missing and we have one.
  if (!given || !family) {
    const source = (displayName ?? '').trim();
    if (source) {
      const parts = source.split(/\s+/);
      if (parts.length >= 2) {
        family = parts.pop()!.slice(0, MAX_NAME_RUNES);
        given = parts.join(' ').slice(0, MAX_NAME_RUNES);
      }
    }
  }

  // Steps 3 & 4: last-resort fallback to the IdP login (GitHub's username), then "user".
  const fallback = clean(idpUserName) || 'user';
  if (!given) given = fallback;
  if (!family) family = fallback;

  return { firstName: given, lastName: family };
}
