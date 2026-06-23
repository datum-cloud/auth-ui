// app/resources/sso/sso-callback.ts
//
// /sso/:provider/callback loader business logic: resolve intent → decide →
// sign-in/link/register/error. Extracted from sso.service.ts. Pure-internal
// decomposition — the `processIdpCallback` signature + `CallbackQuery`/`CallbackLoaderDeps`
// are unchanged and re-exported through the sso barrel.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import {
  readSessions,
  mostRecent,
  addSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { ProviderError } from '@/modules/auth/types';
import type { IdpIntentResult } from '@/modules/auth/types';
import { registerAndLinkIdp } from '@/resources/signup';
import { decideIdpCallback } from '@/resources/sso/idp-callback';
import { signInWithIdpIntent, requestScopedProviderReads } from '@/resources/sso/idp-session';
import type { SsoOutcome } from '@/resources/sso/sso-outcome';
import { logAuthEvent } from '@/server/observability';
import { getOrCreateFingerprintId, userAgentFromRequest } from '@/server/user-agent';
import { providerErrorCode } from '@/utils/errors/auth-error';
import { z } from 'zod';

// ── DI seams ───────────────────────────────────────────────────────

export interface CallbackLoaderDeps {
  retrieveIdpIntent?: (id: string, token: string) => Promise<IdpIntentResult>;
  onAuthEvent?: (event: string, outcome: 'success' | 'failure') => void;
}

// ── /sso/:provider/callback loader ──────────────────────────────────────────────

export const CallbackQuery = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  link: z.string().optional(),
  requestId: z.string().optional(),
  organization: z.string().optional(),
});

/**
 * /sso/:provider/callback loader logic. Validates the query, resolves the IdP intent + the
 * ceremony session user (server-side only — never trusts a client userId), runs the
 * decideIdpCallback decision, and dispatches the resulting sign-in / link / register / error
 * branch. ProviderErrors during intent-fetch/decision redirect to the branded error page and
 * emit a failure audit event; unknown errors re-throw to the root ErrorBoundary.
 */
export async function processIdpCallback(
  provider: AuthProvider,
  request: Request,
  slugParam: string | undefined,
  deps: CallbackLoaderDeps = {}
): Promise<SsoOutcome> {
  const url = new URL(request.url);
  const parsed = CallbackQuery.safeParse(Object.fromEntries(url.searchParams));
  const slug = slugParam ?? 'idp';

  // DI: tests can inject retrieveIdpIntent; production delegates to the resolved provider.
  const doRetrieveIdpIntent =
    deps.retrieveIdpIntent ??
    ((id: string, token: string) => provider.retrieveIdpIntent(id, token));

  if (!parsed.success) {
    return {
      kind: 'redirect',
      location: `/sso/${encodeURIComponent(slug)}/error?reason=context-missing`,
    };
  }

  const { id, token, link, requestId, organization } = parsed.data;

  // Ensure the fingerprintId cookie exists for this browser. The SAME minted id feeds
  // every createSession userAgent below (no first-session gap); fingerprintCookie is
  // null on reuse and rides out on the redirect that finalizes the sign-in.
  const [fingerprintId, fingerprintCookie] = getOrCreateFingerprintId(request);

  // Wrap the intent-fetch + session-resolution + decision block so a transient
  // ProviderError redirects to the branded error page and emits a failure audit event instead
  // of producing a raw 500. Unknown errors (non-ProviderError) re-throw so the root
  // ErrorBoundary handles them.
  let intent: IdpIntentResult;
  let entries: Awaited<ReturnType<typeof readSessions>>;
  let decision: ReturnType<typeof decideIdpCallback>;

  try {
    intent = await doRetrieveIdpIntent(id, token);

    // Resolve the active ceremony user server-side — NEVER trust a client-supplied userId.
    entries = await readSessions(request);
    const recent = mostRecent(entries);

    // The ceremony-session resolution and the login-settings fetch are independent
    // pre-decision reads — run them concurrently instead of serially. getSession goes through
    // the request-scoped read cache so a later overlapping lookup in the same request is free.
    const reads = requestScopedProviderReads(provider, request);
    const sessionUserIdP: Promise<string | null> = recent
      ? // recent.id is a SESSION id, not a user id — getUser(recent.id) was
        // semantically wrong and a wasted call. Resolve the user directly from the session.
        reads
          .getSession(recent.id, recent.token)
          .then((session) => session?.user?.id ?? null)
          // A stale/expired/invalid ceremony-session entry must not abort a fresh IdP sign-in.
          // (Zitadel getSession throws NOT_FOUND for an expired session.) Treat as no user.
          .catch(() => null)
      : Promise.resolve(null);
    const settingsP = provider.getLoginSettings(organization);

    const [sessionUserId, settings] = await Promise.all([sessionUserIdP, settingsP]);

    // Resolve a same-email account ONLY on the register path (not linked, not a link
    // ceremony, creation allowed, draft present) — keeps the lookup off the sign-in path.
    let existingAccount: { userId: string; hasPassword: boolean } | null = null;
    if (link !== 'true' && !intent.userId && settings.allowRegister && intent.draft?.email) {
      const existing = await provider.findUser(intent.draft.email, organization);
      if (existing) {
        const methods = await provider.listAuthMethods(existing.id);
        existingAccount = { userId: existing.id, hasPassword: methods.includes('password') };
      }
    }

    // POSTURE B2 (755-J2): for the link+FRESH-identity case (link ceremony, Zitadel has no
    // mapping yet → intent.userId == null) resolve the Datum account that OWNS the IdP's
    // verified email. decideIdpCallback only links the fresh identity into the session user
    // when this owner IS the session user (mirror of the register-path findUser above — the
    // lookup is scoped to exactly this case so the plain link + sign-in paths pay nothing).
    let linkEmailOwnerUserId: string | null = null;
    if (link === 'true' && !intent.userId && intent.draft?.emailVerified && intent.draft.email) {
      const owner = await provider.findUser(intent.draft.email, organization);
      linkEmailOwnerUserId = owner?.id ?? null;
    }

    decision = decideIdpCallback({
      intent,
      link: link === 'true',
      sessionUserId,
      creationAllowed: settings.allowRegister,
      existingAccount,
      linkEmailOwnerUserId,
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      deps.onAuthEvent?.('idp.signin', 'failure');
      logAuthEvent('idp.signin', 'failure', { reason: err.code, requestId });
      return {
        kind: 'redirect',
        location: `/sso/${encodeURIComponent(slug)}/error?reason=${encodeURIComponent(providerErrorCode(err.code))}`,
      };
    }
    throw err; // unknown → root ErrorBoundary renders the branded page
  }

  switch (decision.kind) {
    case 'sign-in': {
      let setCookie: string;
      let target: string;
      try {
        ({ setCookie, target } = await signInWithIdpIntent(provider, request, {
          idpIntentId: id,
          idpIntentToken: token,
          userId: decision.userId,
          requestId,
          organization,
          fallbackLoginName: intent.information.idpUserName,
          userAgent: userAgentFromRequest(request, fingerprintId),
        }));
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown';
        logAuthEvent('idp.signin', 'failure', {
          userId: decision.userId,
          idpId: intent.information.idpId,
          requestId,
          reason,
        });
        throw err;
      }
      logAuthEvent('idp.signin', 'success', {
        userId: decision.userId,
        idpId: intent.information.idpId,
        requestId,
      });
      const lastUsedCookie = await serializeLastUsedLogin(`idp:${intent.information.idpId}`);
      return {
        kind: 'redirect',
        location: target,
        setCookie,
        lastUsedCookie,
        fingerprintCookie: fingerprintCookie ?? undefined,
      };
    }

    case 'link':
    case 'auto-link': {
      try {
        await provider.addIdpLink(decision.userId, decision.link);

        // Task 6: on auto-link, mark the email verified immediately — the IdP has already
        // vouched for it and Zitadel's account stays "unverified" otherwise. Best-effort:
        // a failure here must NOT abort the link/createSession/redirect (the IdP link itself
        // succeeded and the sign-in is valid). Do NOT emit an idp.link 'failure' audit event
        // for a verify-only side-effect.
        if (decision.kind === 'auto-link' && intent.draft?.email) {
          try {
            await provider.markEmailVerified(decision.userId);
          } catch {
            // best-effort: the IdP already vouched for the email; if the verify call fails the
            // account simply stays unverified (prior behavior) — never block the link + sign-in.
          }
        }

        const session = await provider.createSession(
          { idpIntent: { idpIntentId: id, idpIntentToken: token } },
          {
            requestId,
            orgId: organization,
            userId: decision.userId,
            userAgent: userAgentFromRequest(request, fingerprintId),
          }
        );
        // Elide the post-create getUser(decision.userId) lookup — the cookie's
        // loginName is a display hint and intent.information.idpUserName already carries the
        // IdP-vouched login name (behavior-identical, one fewer RPC on the link/auto-link path).
        const loginName = intent.information.idpUserName;
        const next = addSession(entries, {
          id: session.id,
          token: session.token,
          loginName,
          organization,
          creationTs: session.changedAt,
          expirationTs: session.expiresAt,
          changeTs: session.changedAt,
          requestId,
        });
        logAuthEvent('idp.link', 'success', {
          userId: decision.userId,
          idpId: decision.link.idpId,
          requestId,
          auto: decision.kind === 'auto-link',
        });
        const target = requestId
          ? `/authorize?requestId=${encodeURIComponent(requestId)}`
          : '/signed-in';
        const lastUsedCookie = await serializeLastUsedLogin(`idp:${decision.link.idpId}`);
        return {
          kind: 'redirect',
          location: target,
          setCookie: await serializeSessions(next),
          lastUsedCookie,
          fingerprintCookie: fingerprintCookie ?? undefined,
        };
      } catch (err) {
        if (err instanceof ProviderError) {
          deps.onAuthEvent?.('idp.link', 'failure');
          logAuthEvent('idp.link', 'failure', {
            userId: decision.userId,
            reason: err.code,
            requestId,
          });
          // 755-J1: ALREADY_EXISTS means this IdP identity is already linked to a DIFFERENT
          // Datum account. The generic providerErrorCode() collapses it to `signin_failed`
          // ("Could not complete sign-in") which is misleading — the user needs to know the
          // identity belongs elsewhere. Surface a distinct, accurate reason that reuses the
          // existing access-denied copy ("That identity belongs to a different account.").
          const reason =
            err.code === 'ALREADY_EXISTS'
              ? 'identity-linked-elsewhere'
              : providerErrorCode(err.code);
          return {
            kind: 'redirect',
            location: `/sso/${encodeURIComponent(slug)}/error?reason=${encodeURIComponent(reason)}`,
          };
        }
        throw err; // unknown → root ErrorBoundary
      }
    }

    case 'link-needs-auth': {
      logAuthEvent('idp.link.denied', 'failure', { reason: 'account-exists', requestId });
      const qs = new URLSearchParams({ loginName: decision.email, notice: 'link-existing' });
      if (requestId) qs.set('requestId', requestId);
      if (organization) qs.set('organization', organization);
      return { kind: 'redirect', location: `/login?${qs.toString()}` };
    }

    case 'auto-create': {
      // New IdP user: auto-create (email already verified by the IdP), link, and sign in
      // directly — no /signup/method hop needed.
      try {
        const result = await registerAndLinkIdp(provider, entries, {
          email: decision.draft.email ?? '',
          firstName: decision.draft.firstName ?? '',
          lastName: decision.draft.lastName ?? '',
          organization,
          requestId,
          idpId: decision.link.idpId,
          idpUserId: decision.link.idpUserId,
          idpUserName: decision.link.idpUserName,
          idpIntentId: id,
          idpIntentToken: token,
          emailVerified: intent.draft?.emailVerified ?? false,
          userAgent: userAgentFromRequest(request, fingerprintId),
        });
        const lastUsedCookie = await serializeLastUsedLogin(`idp:${decision.link.idpId}`);
        return {
          kind: 'redirect',
          location: result.target,
          setCookie: await serializeSessions(result.sessions),
          lastUsedCookie,
          fingerprintCookie: fingerprintCookie ?? undefined,
        };
      } catch (err) {
        if (err instanceof ProviderError) {
          deps.onAuthEvent?.('idp.register', 'failure');
          logAuthEvent('idp.register', 'failure', { reason: err.code, requestId });
          return {
            kind: 'redirect',
            location: `/sso/${encodeURIComponent(slug)}/error?reason=${encodeURIComponent(providerErrorCode(err.code))}`,
          };
        }
        throw err; // unknown → root ErrorBoundary
      }
    }

    case 'error': {
      logAuthEvent('idp.link.denied', 'failure', {
        reason: decision.reason,
        idpId: intent.information.idpId,
        requestId,
      });
      return {
        kind: 'redirect',
        location: `/sso/${encodeURIComponent(slug)}/error?reason=${encodeURIComponent(decision.reason)}`,
      };
    }

    default: {
      const exhausted: never = decision;
      throw new Error(`Unhandled decision type: ${exhausted}`);
    }
  }
}
