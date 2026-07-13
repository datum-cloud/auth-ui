export interface ParsedName {
  firstName: string;
  lastName: string;
}

const titleCase = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Derive a best-effort given/family name from an email local part. Both fields are
 * guaranteed non-empty because Zitadel's AddHumanUser requires profile.givenName and
 * familyName. The user edits the real name later in cloud-portal.
 */
export function parseNameFromEmail(email: string): ParsedName {
  const local = (email.split('@')[0] ?? '').split('+')[0];
  const segments = local.split(/[._-]+/).filter(Boolean).map(titleCase);
  if (segments.length === 0) {
    const fallback = titleCase(local) || 'User';
    return { firstName: fallback, lastName: fallback };
  }
  if (segments.length === 1) {
    return { firstName: segments[0], lastName: segments[0] };
  }
  return { firstName: segments[0], lastName: segments.slice(1).join(' ') };
}
