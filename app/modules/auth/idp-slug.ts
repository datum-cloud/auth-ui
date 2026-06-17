import type { IdProvider } from './types';

// v1 supports Google + GitHub. Map mirrors the fork's idpTypeToSlug, trimmed to the supported set.
// P6 Task 9: LDAP uses a dedicated credential-entry route (/sso/ldap) instead of an external
// IdP redirect — the slug 'ldap' routes the sso.tsx action to that screen.
const TYPE_TO_SLUG: Record<string, string> = { GOOGLE: 'google', GITHUB: 'github', LDAP: 'ldap' };

export function idpTypeToSlug(type: string): string | null {
  return TYPE_TO_SLUG[type] ?? null;
}

export function slugToProvider(slug: string, providers: IdProvider[]): IdProvider | null {
  const wanted = slug.toLowerCase();
  return providers.find((p) => idpTypeToSlug(p.type) === wanted) ?? null;
}
