export interface PostLoginDestinationInput {
  isAdmin: boolean;
  /** Zitadel console URL — where instance admins land. */
  consoleUrl: string;
  /** Zitadel-configured default (from getLoginSettings.defaultRedirectUri). Preferred when set. */
  defaultRedirectUri?: string;
  /** DEFAULT_APP_URL env — fallback when Zitadel has no default configured. */
  defaultAppUrl?: string;
}

export type PostLoginSource = 'console' | 'zitadel' | 'env' | 'none';

/**
 * Single source of truth for BOTH the destination and the audit `source` label, so the two
 * can never diverge. Priority: admin console → Zitadel default → env default → none.
 */
export function postLoginDestinationWithSource({
  isAdmin,
  consoleUrl,
  defaultRedirectUri,
  defaultAppUrl,
}: PostLoginDestinationInput): { dest: string | null; source: PostLoginSource } {
  if (isAdmin) return { dest: consoleUrl, source: 'console' };
  const fromZitadel = defaultRedirectUri?.trim();
  if (fromZitadel) return { dest: fromZitadel, source: 'zitadel' };
  const fromEnv = defaultAppUrl?.trim();
  if (fromEnv) return { dest: fromEnv, source: 'env' };
  return { dest: null, source: 'none' };
}

/**
 * Resolve where a standalone (no-authRequest) login should land.
 * - admin → consoleUrl
 * - else  → defaultRedirectUri (Zitadel) when non-blank, then defaultAppUrl (env)
 * - null  → nothing configured; the caller renders the "You are signed in" page
 */
export function postLoginDestination(input: PostLoginDestinationInput): string | null {
  return postLoginDestinationWithSource(input).dest;
}
