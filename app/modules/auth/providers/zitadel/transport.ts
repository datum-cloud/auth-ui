import { type TransportEnv, resolveServiceUrl } from './transport.util';
import type { DescService } from '@bufbuild/protobuf';
import { createClientFor } from '@zitadel/client';
import { createServerTransport as libCreateServerTransport } from '@zitadel/client/node';
import { createHash } from 'node:crypto';

// Re-export so callers that import from this module keep working unchanged.
export type { TransportEnv };
export { resolveServiceUrl };

// Bound the caches and key on a token FINGERPRINT, never the raw
// token. Fingerprinting means a rotated token misses the cache (no stale-client reuse); the
// hard cap means per-session-token churn (changePasswordWithSession) can't leak memory.
const CACHE_MAX = 256;
function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}
// Evict the oldest entry once the cap is hit (Map preserves insertion order).
function capInsert<V>(cache: Map<string, V>, key: string, value: V): void {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// Transports (one HTTP/2 session manager each) are expensive; cache by config so the
// hot login path reuses one connection instead of opening a socket per RPC group.
// Key cardinality: env-config-derived today (~1 entry). When a forward-host resolver is
// wired, the key must remain bounded/trusted — callers
// must validate the forward-host value before it becomes part of the cache key.
const transportCache = new Map<string, ReturnType<typeof libCreateServerTransport>>();

// Mirror fork zitadel.ts:createServerTransport — injects token, applies the extra request
// headers from ZITADEL_CUSTOM_REQUEST_HEADERS (fork name: CUSTOM_REQUEST_HEADERS).
export function createServerTransport(token: string, baseUrl: string, env: TransportEnv = {}) {
  if (!baseUrl) throw new Error('No instance url found');
  if (!token) throw new Error('No service token found');
  const custom = env.ZITADEL_CUSTOM_REQUEST_HEADERS ?? process.env.ZITADEL_CUSTOM_REQUEST_HEADERS;
  const key = `${baseUrl}|${tokenFingerprint(token)}|${custom ?? ''}`;
  const cached = transportCache.get(key);
  if (cached) return cached;
  const transport = libCreateServerTransport(token, {
    baseUrl,
    interceptors: !custom
      ? undefined
      : [
          (next) => (req) => {
            for (const header of custom.split(',')) {
              const [k, v] = header.split(':');
              if (k && v) req.header.set(k.trim(), v.trim());
            }
            return next(req);
          },
        ],
  });
  capInsert(transportCache, key, transport);
  return transport;
}

// Service client cache: keyed by service typeName + transport key so repeat calls
// return the same client instance (avoids re-creating a gRPC channel per method call).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clientCache = new Map<string, any>();

// Build a service client for a given proto service, with token quarantined here.
export function createServiceClient<T extends DescService>(
  service: Parameters<typeof createClientFor<T>>[0],
  token: string,
  serviceUrl: string,
  env?: TransportEnv
): ReturnType<ReturnType<typeof createClientFor<T>>> {
  if (!serviceUrl) throw new Error('No instance url found');
  if (!token) throw new Error('No service token found');
  const custom = env?.ZITADEL_CUSTOM_REQUEST_HEADERS ?? process.env.ZITADEL_CUSTOM_REQUEST_HEADERS;
  const transportKey = `${serviceUrl}|${tokenFingerprint(token)}|${custom ?? ''}`;
  const clientKey = `${(service as { typeName: string }).typeName}|${transportKey}`;
  if (clientCache.has(clientKey)) return clientCache.get(clientKey);
  const client = createClientFor<T>(service)(createServerTransport(token, serviceUrl, env));
  capInsert(clientCache, clientKey, client);
  return client;
}

// Test-only introspection (not part of the public adapter surface).
export const __cacheSize = (): number => clientCache.size;
export const __CACHE_MAX = (): number => CACHE_MAX;
