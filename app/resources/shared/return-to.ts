import { env } from '@/server/infra/env.server';

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Placeholder origin used only to check that an app-relative path stays on this site. */
const SAME_SITE_BASE = 'http://auth-ui.invalid';

/**
 * True when `raw` is an app-relative path that a browser resolves to this site.
 * Parsed rather than prefix-checked: the WHATWG URL rules browsers follow strip
 * tab/CR/LF and treat '\' as '/', so '/\host' and '/<tab>/host' both name another
 * site even though they start with a single '/'.
 */
function isSameSitePath(raw: string): boolean {
  if (!raw.startsWith('/')) return false;
  try {
    return new URL(raw, SAME_SITE_BASE).origin === SAME_SITE_BASE;
  } catch {
    return false;
  }
}

/**
 * Fail-closed returnTo guard (same posture as validatePostLogoutRedirect):
 *  • app-relative path ('/passkeys', '/setup/passkey?…') → allowed when it resolves to
 *    this site (never '//', '/\' or '/<tab>/' — browsers treat those as scheme-relative).
 *    RR7 prefixes the /id basename at redirect/link time, so these ARE the spec's /id/* URLs.
 *  • absolute URL → allowed only when its origin is in POST_LOGOUT_ALLOWLIST.
 *  • anything else → null; callers fall back to their own default.
 * `allowlist` is injectable so tests never touch env.
 */
export function validateReturnTo(
  raw: string | null,
  allowlist: string[] = parseAllowlist(env.POST_LOGOUT_ALLOWLIST)
): string | null {
  if (!raw) return null;
  if (raw.startsWith('/')) return isSameSitePath(raw) ? raw : null;
  try {
    return allowlist.includes(new URL(raw).origin) ? raw : null;
  } catch {
    return null;
  }
}
