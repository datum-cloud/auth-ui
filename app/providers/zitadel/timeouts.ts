// CCD-8 — Network-timeout policy. One place for every outbound deadline used by the
// Zitadel adapter, so timeouts are named, discoverable, and tunable in a single edit.
//
// These bound REQUEST-HANDLER latency: a hung Zitadel instance must never stall an
// auth route indefinitely (availability / DoS — see CODE-MAJ-01).
//
// Promotion note: if per-environment tuning is ever needed, lift these into
// app/utils/env.server.ts as optional, defaulted numbers and pass them through ZitadelOpts.
// Until there is real evidence that need exists (YAGNI), plain constants are sufficient.
export const TIMEOUTS = {
  /** isInstanceAdmin REST membership check (one local network hop). Fail-open on timeout. */
  ADMIN_CHECK_MS: 5_000,
  /** Per-RPC deadline for gRPC/Connect calls wrapped by ZitadelAuthProvider.call(). */
  GRPC_CALL_MS: 10_000,
} as const;
