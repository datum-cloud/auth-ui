import type { AuthProvider } from '@/modules/auth/auth-provider';
import { resolveServiceUrl } from '@/modules/auth/providers/zitadel';
import { getAuthProvider } from '@/modules/auth/select.server';
import { env } from '@/server/infra/env.server';
import { auditSink } from '@/server/observability';

// The env schema only lets the fake provider through in production when
// ALLOW_FAKE_PROVIDER_IN_PRODUCTION=true. Say so loudly at boot, so a deliberate prod-mode fake
// run is never mistaken for a real deployment in the logs. Lives here, not in env.server.ts,
// because observability → request-context → sentry.server already imports env.server.
if (env.NODE_ENV === 'production' && env.AUTH_PROVIDER === 'fake') {
  auditSink(
    JSON.stringify({
      level: 'warn',
      kind: 'boot',
      event: 'fake_provider_in_production',
      message:
        'AUTH_PROVIDER=fake is running under NODE_ENV=production ' +
        '(ALLOW_FAKE_PROVIDER_IN_PRODUCTION=true). Seeded test accounts are live. ' +
        'Never serve this on a public origin.',
    })
  );
}

// THE composition root: the only request-aware site that names a concrete provider.
// Imports the zitadel PUBLIC entry only — the neutral server boundary
// (auth-context.server.ts) now imports zero zitadel modules (transport leak removed).
// Forward-host handling preserved: x-zitadel-forward-host is stripped at the Hono edge; only
// allowlisted values reach resolveServiceUrl via ZITADEL_TRUSTED_FORWARD_HOSTS.
export function providerForRequest(request: Request): AuthProvider {
  const mode = env.AUTH_PROVIDER ?? 'zitadel';
  if (mode === 'fake') return getAuthProvider({ AUTH_PROVIDER: 'fake' });
  const serviceUrl = resolveServiceUrl(request.headers, {
    ZITADEL_API_URL: env.ZITADEL_API_URL,
    trustedForwardHosts: env.ZITADEL_TRUSTED_FORWARD_HOSTS,
  });
  return getAuthProvider({ AUTH_PROVIDER: 'zitadel', serviceUrl });
}
