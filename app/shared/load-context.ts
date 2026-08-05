import { createContext } from 'react-router';

// React Router 8 replaced the plain-object load context with typed context keys
// read through a RouterContextProvider — `getLoadContext` must now return that
// provider instance, not an object literal (see app/server.ts).
//
// The keys live here rather than beside getLoadContext because app/root.tsx and
// app/entry.server.tsx both read them: importing app/server.ts from a
// client-reachable module would drag the Hono server graph into the browser
// bundle. app/shared/ is a leaf by the `shared-is-leaf` dependency-cruiser rule,
// and this module imports nothing but react-router, so it stays one.
//
// Both keys carry explicit defaults: RouterContextProvider#get throws when a key
// has neither a stored value nor a defaultValue, and the previous consumers read
// these through optional chaining, so a missing value must degrade rather than
// throw.

/** Per-request trace id, mirrored from the Hono request-context middleware. */
export const traceIdContext = createContext<string>('');

/**
 * Per-request CSP nonce from hono secure-headers. Undefined in dev, where the
 * policy uses unsafe-inline instead of a nonce.
 */
export const cspNonceContext = createContext<string | undefined>(undefined);
