import type { AuthProvider } from '@/modules/auth/auth-provider';
import { resolveServiceUrl } from '@/modules/auth/providers/zitadel';
import { getAuthProvider } from '@/modules/auth/select.server';
import { env } from '@/server/infra/env.server';

// THE composition root: the only request-aware site that names a concrete provider.
// Imports the zitadel PUBLIC entry only — the neutral server boundary
// (auth-context.server.ts) now imports zero zitadel modules (transport leak removed).
// EL-TRANSPORT-1 preserved: x-zitadel-forward-host is stripped at the Hono edge; only
// allowlisted values reach resolveServiceUrl via ZITADEL_TRUSTED_FORWARD_HOSTS.
export function providerForRequest(request: Request): AuthProvider {
  const mode = process.env.AUTH_PROVIDER ?? 'zitadel';
  if (mode === 'fake') return getAuthProvider({ AUTH_PROVIDER: 'fake' });
  const serviceUrl = resolveServiceUrl(request.headers, {
    ZITADEL_API_URL: env.ZITADEL_API_URL,
    trustedForwardHosts: env.ZITADEL_TRUSTED_FORWARD_HOSTS,
  });
  return getAuthProvider({ AUTH_PROVIDER: 'zitadel', serviceUrl });
}
