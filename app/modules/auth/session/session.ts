export interface SessionEntry {
  id: string;
  token: string;
  loginName: string;
  organization?: string;
  creationTs: string;
  expirationTs: string;
  changeTs: string;
  requestId?: string;
}

export function addSession(list: SessionEntry[], entry: SessionEntry): SessionEntry[] {
  return [...list.filter((s) => s.id !== entry.id), entry];
}
export function removeSession(list: SessionEntry[], id: string): SessionEntry[] {
  return list.filter((s) => s.id !== id);
}
/**
 * Timestamps in SessionEntry arrive in two formats: numeric-epoch strings
 * (early P0 writers/tests) and ISO-8601 strings (`Session.expiresAt/changedAt`
 * from the provider, stored verbatim by the login routes). `Number(ISO)` is NaN,
 * which silently broke expiry filtering and recency sorting — parse both.
 * Unparseable values map to NaN → treated as expired / oldest.
 */
function tsMs(value: string): number {
  const n = Number(value);
  return Number.isNaN(n) ? Date.parse(value) : n;
}

export function listSessions(list: SessionEntry[], nowMs: number): SessionEntry[] {
  return list.filter((s) => {
    // Unknown expiry → KEEP. Zitadel Session-API sessions created without an explicit lifetime
    // carry no expirationDate (mapper → ''); since Number('') === 0, the naive `tsMs > now` read
    // an absent expiry as "expired in 1970" and dropped every entry, leaving the /accounts
    // multi-account picker permanently empty. An empty/unparseable expirationTs means "no known
    // expiry" — keep it and let the /accounts loader re-validate true liveness against the
    // provider (it renders a "needs re-authentication" card for dead sessions). Only entries
    // with a KNOWN expiry in the past are dropped here.
    if (s.expirationTs === '') return true;
    const ms = tsMs(s.expirationTs);
    return Number.isNaN(ms) ? true : ms > nowMs;
  });
}
export function mostRecent(list: SessionEntry[]): SessionEntry | undefined {
  return [...list].sort((a, b) => tsMs(b.changeTs) - tsMs(a.changeTs))[0];
}
export function byId(list: SessionEntry[], id: string): SessionEntry | undefined {
  return list.find((s) => s.id === id);
}

// An entry kept by listSessions purely because its expirationTs is empty (SAML /
// Session-API sessions with no declared lifetime) has NO client-side liveness signal — the BFF
// MUST re-verify it against the provider before acting on it. This predicate makes that policy
// explicit and testable; the SAML-post handler's getSession self-heal honours it.
export function needsLivenessCheck(entry: SessionEntry): boolean {
  return entry.expirationTs === '';
}

export function byLoginName(
  list: SessionEntry[],
  loginName: string,
  organization?: string
): SessionEntry | undefined {
  return list.find(
    (s) => s.loginName === loginName && (!organization || s.organization === organization)
  );
}

// Pure cookie-size guard (spec §7): keep newest sessions; evict oldest by changeTs
// until the serialized size (measured by the injected sizeOf) fits maxBytes.
export function capSessions(
  list: SessionEntry[],
  maxBytes: number,
  sizeOf: (list: SessionEntry[]) => number
): SessionEntry[] {
  const byNewest = [...list].sort((a, b) => tsMs(b.changeTs) - tsMs(a.changeTs));
  let kept = byNewest;
  while (kept.length > 0 && sizeOf(kept) > maxBytes) {
    kept = kept.slice(0, -1); // drop the oldest (last after newest-first sort)
  }
  // restore insertion-ish order (oldest → newest) for stable cookie output
  return [...kept].sort((a, b) => tsMs(a.changeTs) - tsMs(b.changeTs));
}
