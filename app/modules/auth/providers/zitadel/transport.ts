import { type TransportEnv, resolveServiceUrl } from './transport.util';
import { parseCustomRequestHeaders } from '@/shared/custom-request-headers';
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

// Parse ZITADEL_CUSTOM_REQUEST_HEADERS into header pairs. The env schema rejects a malformed
// value at boot; this guard covers a raw process.env read that never went through the schema,
// so a bad entry fails loudly here instead of being dropped from every request.
function customRequestHeaders(raw: string | undefined) {
  const { headers, malformed } = parseCustomRequestHeaders(raw);
  if (malformed.length > 0) {
    // Entry count only: a header value can be a credential, so the text stays out of the error.
    throw new Error(
      `ZITADEL_CUSTOM_REQUEST_HEADERS has ${malformed.length} malformed entr${malformed.length === 1 ? 'y' : 'ies'} (expected comma-separated Name:Value pairs)`
    );
  }
  return headers;
}

// Mirror fork zitadel.ts:createServerTransport — injects token, applies the extra request
// headers from ZITADEL_CUSTOM_REQUEST_HEADERS (fork name: CUSTOM_REQUEST_HEADERS).
export function createServerTransport(token: string, baseUrl: string, env: TransportEnv = {}) {
  if (!baseUrl) throw new Error('No instance url found');
  if (!token) throw new Error('No service token found');
  const custom = env.ZITADEL_CUSTOM_REQUEST_HEADERS ?? process.env.ZITADEL_CUSTOM_REQUEST_HEADERS;
  const key = `${baseUrl}|${tokenFingerprint(token)}|${custom ?? ''}`;
  const cached = transportCache.get(key);
  if (cached) return cached;
  // Parsed ONCE per transport (the transport is cached), not on every RPC.
  const headers = customRequestHeaders(custom);
  const transport = libCreateServerTransport(token, {
    baseUrl,
    interceptors:
      headers.length === 0
        ? undefined
        : [
            (next) => (req) => {
              for (const [name, value] of headers) req.header.set(name, value);
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
