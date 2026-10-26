// Derive a Zitadel-valid given/family name from an IdP draft.
//
// Some IdPs (notably GitHub) return NO givenName/familyName — often no name at all,
// only the account login. Sending empty firstName/lastName to addHumanUser makes
// Zitadel reject the register: `invalid SetHumanProfile.GivenName: value length must
// be between 1 and 200 runes`. This helper reproduces the old login app's fallback
// chain so the register always carries non-empty profile names.
import { placeholderNameFromEmail } from '@/resources/signup/placeholder-name';

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

const isEmailShaped = (value: string): boolean => value.includes('@');

// An email is never a name: email-shaped IdP names count as missing.
const cleanName = (value: string | undefined): string => {
  const cleaned = clean(value);
  return isEmailShaped(cleaned) ? '' : cleaned;
};

// Google and other OIDC IdPs report the email as the IdP userName — reduce it to the
// local part the same way the email-signup placeholder does.
const cleanFallback = (idpUserName: string | undefined): string => {
  const cleaned = clean(idpUserName);
  if (!isEmailShaped(cleaned)) return cleaned || 'user';
  return placeholderNameFromEmail(cleaned).firstName;
};

/**
 * Compute a non-empty { firstName, lastName } from an IdP draft:
 *   1. start with the IdP-provided given/family (email-shaped values count as missing),
 *   2. if EITHER is empty AND a displayName is present, derive both by splitting the
 *      displayName on whitespace (leading tokens → given, last token → family),
 *   3. if exactly one is still empty, mirror the present one into it,
 *   4. if both are still empty, put idpUserName (its local part when email-shaped, else
 *      "user") into both.
 * Steps 3 and 4 deliberately produce givenName == familyName: milo's UserController then
 * sets iam.miloapis.com/name-review-required and cloud-portal asks for the real name.
 * Every output is trimmed and capped at 200 runes.
 */
export function deriveIdpProfileName({
  firstName,
  lastName,
  displayName,
  idpUserName,
}: DeriveIdpProfileNameInput): DeriveIdpProfileNameResult {
  let given = cleanName(firstName);
  let family = cleanName(lastName);

  // Step 2: derive from displayName only when something is still missing and we have one.
  if (!given || !family) {
    const source = cleanName(displayName);
    if (source) {
      const parts = source.split(/\s+/);
      if (parts.length >= 2) {
        family = parts.pop()!.slice(0, MAX_NAME_RUNES);
        given = parts.join(' ').slice(0, MAX_NAME_RUNES);
      }
    }
  }

  if (given && family) return { firstName: given, lastName: family };

  // Steps 3 & 4: mirror the partial name, else fall back to the IdP login (or "user").
  const name = given || family || cleanFallback(idpUserName);
  return { firstName: name, lastName: name };
}
