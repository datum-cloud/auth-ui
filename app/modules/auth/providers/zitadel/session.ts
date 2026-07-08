// session capability — createSession, getSession, updateSession, deleteSession, listSessions.
import type { ZitadelCtx } from './context';
import { toChallengeRequest, toChecks, toSession, toSessionChallenges } from './mappers';
import type { SessionChecks, SessionOpts } from '@/modules/auth/auth-provider';
import type { Session } from '@/modules/auth/types';
import { create } from '@zitadel/client';
import {
  SearchQuerySchema as SessionSearchQuerySchema,
  UserAgentSchema,
  UserAgent_HeaderValuesSchema,
} from '@zitadel/proto/zitadel/session/v2/session_pb';
import {
  ChecksSchema,
  SessionService,
  ListSessionsRequestSchema,
} from '@zitadel/proto/zitadel/session/v2/session_service_pb';

// gRPC/Connect Code.NotFound — the code a not-yet-replicated read surfaces as (see mappers.ts's
// GRPC_CODE table: 5 → NOT_FOUND). Used to gate the createSession read-retry below.
const GRPC_CODE_NOT_FOUND = 5;
// Backoffs for retrying ONLY the mandatory post-createSession read when it races replica lag
// (~1.05s worst case beyond the initial read). The WRITE is never re-issued, so this can never
// mint a duplicate/orphaned session — unlike an outer retry wrapped around the whole createSession.
const CREATE_SESSION_READ_BACKOFFS_MS = [150, 300, 600];

export function createSession(
  ctx: ZitadelCtx,
  checks: SessionChecks,
  opts?: SessionOpts
): Promise<Session> {
  const sessions = ctx.svc(SessionService);
  return ctx.call(async () => {
    // Phase 1: user-only or user+password. User must be selected before createSession in the real flow;
    // /login resolves the user first via findUser, so we pass the userId via opts.userId.
    const userId = opts?.userId;
    const builtChecks = create(ChecksSchema, {
      ...(userId ? { user: { search: { case: 'userId', value: userId } } } : {}),
      // Use presence semantics (undefined check, not truthiness) so an empty-string password
      // is forwarded to Zitadel rather than silently dropped — let the server reject it.
      ...(checks.password !== undefined ? { password: { password: checks.password } } : {}),
      // IdP intent check: when the caller has an idpIntentId+Token from a completed OAuth flow,
      // pass it to Zitadel so the session is established via the IdP factor.
      ...(checks.idpIntent !== undefined
        ? {
            idpIntent: {
              idpIntentId: checks.idpIntent.idpIntentId,
              idpIntentToken: checks.idpIntent.idpIntentToken,
            },
          }
        : {}),
    });
    // Give the session an explicit lifetime so Zitadel returns an expirationDate. Without it the
    // session carries none → the mapper stores expiresAt='' → /accounts filters every entry as
    // "expired" (Number('')===0), leaving the multi-account picker permanently empty. 12h matches
    // the access-token window and stays well under typical instance session caps.
    const lifetimeSeconds = 12 * 60 * 60;
    // Forward REAL session metadata (e.g. the MaxMind device-tracking token under
    // 'maxmind/tracking-token'). The proto field is map<string, bytes>, so each
    // string value is TextEncoder-encoded to bytes. Omit the field entirely when
    // there is no metadata so we never send an empty map.
    const encoder = new TextEncoder();
    const metadata = opts?.metadata
      ? Object.fromEntries(Object.entries(opts.metadata).map(([k, v]) => [k, encoder.encode(v)]))
      : undefined;
    // Forward Zitadel UserAgent so cloud-portal shows Device/Location on active sessions.
    // Map our ZitadelUserAgent shape onto the proto UserAgent message.
    // header values are repeated strings wrapped in a HeaderValues sub-message.
    const userAgent = opts?.userAgent
      ? create(UserAgentSchema, {
          ...(opts.userAgent.fingerprintId !== undefined
            ? { fingerprintId: opts.userAgent.fingerprintId }
            : {}),
          ...(opts.userAgent.ip !== undefined ? { ip: opts.userAgent.ip } : {}),
          ...(opts.userAgent.description !== undefined
            ? { description: opts.userAgent.description }
            : {}),
          ...(opts.userAgent.header !== undefined
            ? {
                header: Object.fromEntries(
                  Object.entries(opts.userAgent.header).map(([k, v]) => [
                    k,
                    create(UserAgent_HeaderValuesSchema, { values: v.values }),
                  ])
                ),
              }
            : {}),
        })
      : undefined;
    const created = await sessions.createSession(
      {
        checks: builtChecks,
        lifetime: { seconds: BigInt(lifetimeSeconds) },
        ...(metadata ? { metadata } : {}),
        ...(userAgent ? { userAgent } : {}),
      },
      {}
    );
    // Single (not double) fetch. CreateSessionResponse carries ONLY
    // {details, sessionId, sessionToken, challenges} (zitadel.session.v2.CreateSessionResponse) —
    // it does NOT return the Session entity, so user/factors/expirationDate cannot be
    // reconstructed from the create response. `toSession` needs that full entity (its derived
    // state — `user`, `factors`, `expiresAt` — drives /accounts liveness and step routing), so
    // exactly ONE follow-up getSession is REQUIRED here; it is not a redundant double-fetch.
    // Reconstructing the Session from the create response would be unsound, so we keep the one
    // necessary read.
    // Read-after-write lag: the session we JUST wrote may not be visible yet on the replica this
    // follow-up read lands on — it can surface as a NotFound throw OR (rarely) an empty response.
    // Retry the READ ONLY: it reuses created.sessionId/sessionToken and is idempotent, so — unlike
    // an outer retry wrapped around createSession — it can never mint a second, orphaned session.
    // Bounded + short; a genuine (non-NotFound) error propagates immediately, unchanged.
    for (let attempt = 0; ; attempt++) {
      try {
        const got = await sessions.getSession(
          { sessionId: created.sessionId, sessionToken: created.sessionToken },
          {}
        );
        if (got.session) return toSession(got.session, created.sessionToken);
      } catch (err) {
        const grpcCode = (err as { code?: number } | null)?.code;
        if (grpcCode !== GRPC_CODE_NOT_FOUND || attempt >= CREATE_SESSION_READ_BACKOFFS_MS.length) {
          throw err;
        }
      }
      if (attempt >= CREATE_SESSION_READ_BACKOFFS_MS.length) {
        throw new Error('Could not load created session');
      }
      await new Promise<void>((r) => setTimeout(r, CREATE_SESSION_READ_BACKOFFS_MS[attempt]));
    }
  });
}

export function getSession(ctx: ZitadelCtx, id: string, token: string): Promise<Session | null> {
  const sessions = ctx.svc(SessionService);
  return ctx.call(async () => {
    const resp = await sessions.getSession({ sessionId: id, sessionToken: token }, {});
    return resp.session ? toSession(resp.session, token) : null;
  });
}

export function updateSession(
  ctx: ZitadelCtx,
  id: string,
  token: string,
  checks: SessionChecks
): Promise<Session> {
  const sessions = ctx.svc(SessionService);
  return ctx.call(async () => {
    const mfaChecks = toChecks(checks);
    const built = create(ChecksSchema, {
      // Use presence semantics (undefined check, not truthiness) so an empty-string password
      // is forwarded to Zitadel rather than silently dropped — let the server reject it.
      ...(checks.password !== undefined ? { password: { password: checks.password } } : {}),
      // IdP intent check (P4)
      ...(checks.idpIntent !== undefined
        ? {
            idpIntent: {
              idpIntentId: checks.idpIntent.idpIntentId,
              idpIntentToken: checks.idpIntent.idpIntentToken,
            },
          }
        : {}),
      // P5 MFA checks: webAuthN / totp / otpSms / otpEmail
      ...(mfaChecks.webAuthN !== undefined ? { webAuthN: mfaChecks.webAuthN } : {}),
      ...(mfaChecks.totp !== undefined ? { totp: mfaChecks.totp } : {}),
      ...(mfaChecks.otpSms !== undefined ? { otpSms: mfaChecks.otpSms } : {}),
      ...(mfaChecks.otpEmail !== undefined ? { otpEmail: mfaChecks.otpEmail } : {}),
    });
    // P5: if the caller requests challenges, map them and include on the SetSession request.
    const challengeReq = checks.challenges ? toChallengeRequest(checks.challenges) : undefined;
    const updated = await sessions.setSession(
      {
        sessionId: id,
        sessionToken: token,
        checks: built,
        ...(challengeReq ? { challenges: challengeReq } : {}),
      },
      {}
    );
    const newToken = updated.sessionToken || token;
    // Single (not double) fetch, same constraint as createSession.
    // SetSessionResponse carries ONLY {details, sessionToken, challenges}
    // (zitadel.session.v2.SetSessionResponse) — it omits the Session entity, so the refreshed
    // factors/user/expiry cannot be reconstructed from the set response. `toSession` needs the
    // full entity to reflect the just-applied factor (e.g. the verified second factor), so
    // exactly ONE getSession is REQUIRED. The live challenges that ARE on the SetSession
    // response are merged below, since the GetSession entity has no challenges field.
    const got = await sessions.getSession({ sessionId: id, sessionToken: newToken }, {});
    if (!got.session) throw new Error('Could not load updated session');
    const session = toSession(got.session, newToken);
    // Surface SetSessionResponse.challenges onto the returned session so routes can
    // drive the browser WebAuthn ceremony. The Session entity proto (GetSession path)
    // has no challenges field — only the SetSession response carries them live.
    return updated.challenges
      ? { ...session, challenges: toSessionChallenges(updated.challenges) }
      : session;
  });
}

export async function deleteSession(ctx: ZitadelCtx, id: string, token: string): Promise<void> {
  const sessions = ctx.svc(SessionService);
  await ctx.call(() => sessions.deleteSession({ sessionId: id, sessionToken: token }, {}));
}

export function listSessions(ctx: ZitadelCtx, ids: string[]): Promise<Session[]> {
  const sessions = ctx.svc(SessionService);
  return ctx.call(async () => {
    const req = create(ListSessionsRequestSchema, {
      queries: [
        create(SessionSearchQuerySchema, {
          query: { case: 'idsQuery', value: { ids } },
        }),
      ],
    });
    const resp = await sessions.listSessions(req, {});
    // ListSessions RPC never returns session tokens — empty string is intentional;
    // these Session objects are read-only enrichment and cannot be used with updateSession/deleteSession.
    return (resp.sessions ?? []).map((s) => toSession(s, ''));
  });
}
