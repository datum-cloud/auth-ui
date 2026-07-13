// app/modules/auth/providers/zitadel/transport.util.ts
//
// Pure, browser-safe URL helpers extracted from transport.ts so that component specs can import
// the REAL resolveServiceUrl without pulling in the node-only transport machinery
// (node:crypto, @zitadel/client/node). No node-only imports are permitted in this file.

export interface TransportEnv {
  ZITADEL_API_URL?: string;
  ZITADEL_CUSTOM_REQUEST_HEADERS?: string;
  // Fail-closed allowlist for x-zitadel-forward-host.
  // Unset or empty array = reject ALL forward-host overrides.
  trustedForwardHosts?: string[];
}

// Normalise a host value to an https:// URL (strips trailing slashes for comparison).
function normalizeForwardHost(raw: string): string {
  const with_scheme =
    raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  return with_scheme.replace(/\/+$/, '');
}

// Forward-host header accepted ONLY if its https-normalized value
// is in the trustedForwardHosts allowlist. Unset/empty list → reject all.
export function resolveServiceUrl(headers: Headers, env: TransportEnv): string {
  const forwarded = headers.get('x-zitadel-forward-host');
  if (forwarded) {
    const normalized = normalizeForwardHost(forwarded);
    const trusted = (env.trustedForwardHosts ?? []).map(normalizeForwardHost);
    if (trusted.length > 0 && trusted.includes(normalized)) {
      return normalized;
    }
    // Not in allowlist (or list is empty) — fall through to env URL, not forward host.
    // Throw the same generic error so the caller cannot distinguish "not trusted" from
    // "no URL configured" (no information leakage about the allowlist).
    throw new Error('Zitadel service URL could not be determined');
  }
  if (env.ZITADEL_API_URL) return env.ZITADEL_API_URL;
  throw new Error('Zitadel service URL could not be determined');
}
