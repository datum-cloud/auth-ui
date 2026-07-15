export interface PlaceholderName {
  firstName: string;
  lastName: string;
}

/**
 * Derive a placeholder name from an email local part: the raw local part (+tag stripped),
 * or 'user' when that is empty. Both fields intentionally carry the SAME value — milo's
 * UserController sets the iam.miloapis.com/name-review-required annotation when
 * givenName != "" && givenName == familyName, which makes cloud-portal force the
 * "Complete your profile" screen where the user enters their real name (mirroring the
 * GitHub SSO fallback in deriveIdpProfileName, which puts the login in both fields).
 * Non-empty is a hard requirement: Zitadel's AddHumanUser rejects empty
 * profile.givenName/familyName (1–200 runes) — hence the fallback and the 200 cap.
 */
export function placeholderNameFromEmail(email: string): PlaceholderName {
  const local = (email.split('@')[0] ?? '').split('+')[0].trim();
  const placeholder = (local || 'user').slice(0, 200);
  return { firstName: placeholder, lastName: placeholder };
}
