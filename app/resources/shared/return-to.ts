import { env } from '@/server/infra/env.server';

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Fail-closed returnTo guard (same posture as validatePostLogoutRedirect):
 *  • app-relative path ('/passkeys', '/setup/passkey?…') → allowed when it starts with a
 *    single '/' (never '//' or '/\' — browsers treat those as scheme-relative). RR7
 *    prefixes the /id basename at redirect/link time, so these ARE the spec's /id/* URLs.
 *  • absolute URL → allowed only when its origin is in POST_LOGOUT_ALLOWLIST.
 *  • anything else → null; callers fall back to their own default.
 * `allowlist` is injectable so tests never touch env.
 */
export function validateReturnTo(
  raw: string | null,
  allowlist: string[] = parseAllowlist(env.POST_LOGOUT_ALLOWLIST)
): string | null {
  if (!raw) return null;
  if (/^\/(?![/\\])/.test(raw)) return raw;
  try {
    return allowlist.includes(new URL(raw).origin) ? raw : null;
  } catch {
    return null;
  }
}
