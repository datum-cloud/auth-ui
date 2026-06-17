import { getAuthProvider } from '@/providers/select.server';
import { resolveServiceUrl } from '@/providers/zitadel/transport';
import { env } from '@/utils/env.server';

// Routes import THIS, not providers/zitadel/*. It returns the neutral AuthProvider.
// EL-TRANSPORT-1: x-zitadel-forward-host is stripped at the Hono edge (server.ts) so
// only allowlisted values reach here via resolveServiceUrl. The ZITADEL_TRUSTED_FORWARD_HOSTS
// env var controls the allowlist; unset = reject all (fail-closed).
export function providerForRequest(request: Request) {
  const mode = process.env.AUTH_PROVIDER ?? 'zitadel';
  if (mode === 'fake') return getAuthProvider({ AUTH_PROVIDER: 'fake' });
  const serviceUrl = resolveServiceUrl(request.headers, {
    ZITADEL_API_URL: env.ZITADEL_API_URL,
    trustedForwardHosts: env.ZITADEL_TRUSTED_FORWARD_HOSTS,
  });
  return getAuthProvider({ AUTH_PROVIDER: 'zitadel', serviceUrl });
}
