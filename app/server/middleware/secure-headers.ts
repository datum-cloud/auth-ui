// Relocated to the server/edge layer (request-bound Hono code). Re-export shim;
// removed once importers (server.ts wiring) are migrated. Keeps the CSP nonce test green.
export * from '@/server/edge/secure-headers';
