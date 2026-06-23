// app/resources/sso/sso-outcome.ts
//
// The typed `SsoOutcome` discriminated union plus the single `outcomeToResponse`
// translator that turns it into the redirect/JSON/data Response a route returns
// verbatim. Extracted from sso.service.ts — the shared outcome contract
// the action/ldap/callback surfaces all return.
import { data, redirect } from 'react-router';

// ── Typed outcomes ──────────────────────────────────────────────────────────────
// `data` carries a `data()` payload (the route returns it verbatim — RR serializes it);
// `redirect` carries a Location + optional set-cookie; `response` carries a raw Response
// (used for plain 400 Bad Request and 502 data responses).

export type SsoOutcome =
  | {
      kind: 'redirect';
      location: string;
      setCookie?: string;
      lastUsedCookie?: string;
      // fingerprintId Set-Cookie minted for a browser that lacked it (null/absent on reuse).
      fingerprintCookie?: string;
    }
  | { kind: 'data'; payload: unknown; status?: number; headers?: Record<string, string> }
  | { kind: 'response'; response: Response };

/**
 * Turn an SsoOutcome into the Response/value the route returns. This is the ONLY place
 * redirect()/data()/Response construction happens for the action+ldap surfaces, so the
 * routes stay thin translators. Service tests assert against what this produces.
 */
export function outcomeToResponse(outcome: SsoOutcome): Response | ReturnType<typeof data> {
  switch (outcome.kind) {
    case 'redirect':
      if (outcome.setCookie || outcome.lastUsedCookie || outcome.fingerprintCookie) {
        const h = new Headers();
        if (outcome.setCookie) h.append('set-cookie', outcome.setCookie);
        if (outcome.lastUsedCookie) h.append('set-cookie', outcome.lastUsedCookie);
        if (outcome.fingerprintCookie) h.append('set-cookie', outcome.fingerprintCookie);
        return redirect(outcome.location, { headers: h });
      }
      return redirect(outcome.location);
    case 'data':
      return data(outcome.payload, {
        status: outcome.status,
        headers: outcome.headers,
      });
    case 'response':
      return outcome.response;
  }
}
