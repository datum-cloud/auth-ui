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
  sessionEntryFromSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { serializePasskeyHint } from '@/modules/auth/session/passkey-hint';
import { clearReauthIntent, readReauthIntent } from '@/modules/auth/session/reauth-intent';
import { ProviderError } from '@/modules/auth/types';
import type { IdpIntentResult } from '@/modules/auth/types';
import { authorizeHandbackTarget, ssoErrorRedirect } from '@/resources/shared/next-step-params';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { registerAndLinkIdp } from '@/resources/signup';
import { MAXMIND_TRACKING_TOKEN_METADATA_KEY } from '@/resources/signup/signup.service';
import { deriveIdpProfileName } from '@/resources/sso/derive-idp-name';
import { decideIdpCallback } from '@/resources/sso/idp-callback';
import { signInWithIdpIntent, requestScopedProviderReads } from '@/resources/sso/idp-session';
import type { SsoOutcome } from '@/resources/sso/sso-outcome';
import { env } from '@/server/infra/env.server';
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
  // Attacker-controllable from the callback URL; POSTURE B2 is fail-closed against a wrong org, but
  // cap the length as defense-in-depth (Zitadel org ids are short numeric strings).
  organization: z.string().max(64).optional(),
  // MaxMind device-fingerprint token captured client-side and threaded through the OAuth
  // round-trip (see idp-return-urls.ts) so it can be attached to the resulting session's metadata.
  deviceTrackingToken: z.string().optional(),
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

  // Account-linking policy flags (read once at the orchestration boundary; the pure
  // decideIdpCallback receives them as booleans and never imports env).
  const allowAutoLink = env.ALLOW_IDP_AUTO_LINK;
  const allowLinkAnyEmail = env.ALLOW_IDP_LINK_ANY_EMAIL;

  // DI: tests can inject retrieveIdpIntent; production delegates to the resolved provider.
  const doRetrieveIdpIntent =
    deps.retrieveIdpIntent ??
    ((id: string, token: string) => provider.retrieveIdpIntent(id, token));

  if (!parsed.success) {
    // Validation failed (e.g. missing id/token) — parsed.data is unavailable, so read
    // requestId/organization directly off the raw URL (best-effort; it only rides through to the
    // error page's "Back to sign in" link). Cap the length to match CallbackQuery's max(64)
    // defense-in-depth — an oversized `organization` is itself one way to land in this branch, so
    // don't let the raw read bypass the cap the validated path applies.
    const rawRequestId = url.searchParams.get('requestId')?.slice(0, 64) ?? undefined;
    const rawOrganization = url.searchParams.get('organization')?.slice(0, 64) ?? undefined;
    return {
      kind: 'redirect',
      location: ssoErrorRedirect(slug, 'context-missing', rawRequestId, rawOrganization),
    };
  }

  const { id, token, link, requestId, organization, deviceTrackingToken } = parsed.data;

  // Ensure the fingerprintId cookie exists for this browser. The SAME minted id feeds
  // every createSession userAgent below (no first-session gap); fingerprintCookie is
  // null on reuse and rides out on the redirect that finalizes the sign-in.
  const [fingerprintId, fingerprintCookie] = getOrCreateFingerprintId(request);

  // RE-AUTH cleanup: if a re-auth intent is in flight, every terminal branch below that
  // establishes a session (sign-in handles its own clear + mismatch check inside
  // signInWithIdpIntent; link / auto-link / auto-create / link-needs-auth use this) must clear the
  // marker. Otherwise a stale intent would gate a later unrelated login within its 10-min window
  // (e.g. the link-needs-auth → /login → password step would false-mismatch the link target).
  const reauthClear = (await readReauthIntent(request)) ? await clearReauthIntent() : undefined;

  // Wrap the intent-fetch + session-resolution + decision block so a transient
  // ProviderError redirects to the branded error page and emits a failure audit event instead
  // of producing a raw 500. Unknown errors (non-ProviderError) re-throw so the root
  // ErrorBoundary handles them.
  let intent: IdpIntentResult;
  let entries: Awaited<ReturnType<typeof readSessions>>;
  let decision: ReturnType<typeof decideIdpCallback>;
  // Resolve the effective org for this callback ceremony — org-first (URL ?organization=),
  // then ZITADEL_DEFAULT_ORG_ID env pin, then the provider's instance Default Organization.
  // Hoisted before the try block so both the decision try and the auto-create switch case
  // can reference it. This resolved org feeds the allowRegister gate (getLoginSettings) and
  // the auto-create register call so a bare (no ?organization=) flow always has a concrete
  // org, preventing Zitadel's FAILED_PRECONDITION on addHumanUser with no org.
  // NOTE: findUser calls below deliberately stay on raw `organization` (instance-wide lookup).
  const callbackOrg = await resolveOrg(provider, organization);

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
    // BUG 2 fix: read allowRegister from the org we'll register into (callbackOrg), not
    // instance-level (raw organization). On a bare flow organization is undefined, so the
    // instance settings could allow/deny differently from the target org's policy.
    const settingsP = provider.getLoginSettings(callbackOrg);

    const [sessionUserId, settings] = await Promise.all([sessionUserIdP, settingsP]);

    // Resolve a same-email account ONLY on the register path (not linked, not a link ceremony,
    // creation allowed, draft present) — keeps the lookup off the sign-in path.
    let existingAccount: { userId: string; hasPassword: boolean } | null = null;
    if (link !== 'true' && !intent.userId && settings.allowRegister && intent.draft?.email) {
      const existing = await provider.findUser(intent.draft.email, organization);
      if (existing) {
        // hasPassword only changes the decision when auto-link is enabled; skip the extra RPC
        // when ALLOW_IDP_AUTO_LINK is off (existence alone yields the account-exists hard error).
        const hasPassword = allowAutoLink
          ? (await provider.listAuthMethods(existing.id)).includes('password')
          : false;
        existingAccount = { userId: existing.id, hasPassword };
      }
    }

    // POSTURE B2: only when ALLOW_IDP_LINK_ANY_EMAIL is OFF do we resolve the Datum account that
    // OWNS the IdP's verified email (link+fresh-identity case). When any-email linking is on, the
    // decision ignores the owner, so the lookup is skipped entirely.
    let linkEmailOwnerUserId: string | null = null;
    if (
      !allowLinkAnyEmail &&
      link === 'true' &&
      !intent.userId &&
      intent.draft?.emailVerified &&
      intent.draft.email
    ) {
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
      allowAutoLink,
      allowLinkAnyEmail,
    });
    // Account-link-by-email decision: a fresh external IdP whose verified email matches an
    // existing account. Logged (PII-safe) so this new "sign in to link" / silent-auto-link path
    // is diagnosable. auto-link fires only when the IdP email is verified AND the existing account
    // has no password; otherwise the user must authenticate first (link-needs-auth).
    if (decision.kind === 'link-needs-auth') {
      logAuthEvent('idp.link', 'failure', {
        reason: 'needs_auth',
        requestId,
        idpId: intent.information?.idpId,
        emailVerified: intent.draft?.emailVerified ?? false,
        existingHasPassword: existingAccount?.hasPassword ?? false,
      });
    } else if (decision.kind === 'auto-link') {
      logAuthEvent('idp.link', 'success', {
        reason: 'auto_linked',
        requestId,
        idpId: intent.information?.idpId,
      });
    }

    // Diagnostic (PII-safe): trace WHY an explicit link ceremony resolved as it did, so staging
    // logs explain an access-denied without guesswork. Only on the link path (link=true), which is
    // low volume. Surfaces the flag + the shape discriminators — read it as:
    //   intentMapped=true, intentMatchesSession=false  → Shape 1: identity already linked elsewhere
    //   intentMapped=false, allowLinkAnyEmail=false     → Shape 2 B2: emailVerified / owner checks
    //   allowLinkAnyEmail=true                          → fresh identity should link (never denied)
    // NO email/loginName VALUES are logged (audit PII guard) — only booleans + idpId + reason.
    if (link === 'true') {
      logAuthEvent('idp_link_decision', decision.kind === 'error' ? 'failure' : 'success', {
        requestId,
        idpId: intent.information?.idpId,
        decision: decision.kind,
        reason: decision.kind === 'error' ? decision.reason : undefined,
        allowLinkAnyEmail,
        intentMapped: intent.userId != null, // false ⇒ fresh identity (Shape 2)
        intentMatchesSession: intent.userId != null && intent.userId === sessionUserId,
        sessionPresent: sessionUserId != null,
        emailVerified: intent.draft?.emailVerified ?? false,
        emailOwnerResolved: linkEmailOwnerUserId != null,
        emailOwnerMatchesSession:
          linkEmailOwnerUserId != null && linkEmailOwnerUserId === sessionUserId,
      });
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      deps.onAuthEvent?.('idp.signin', 'failure');
      logAuthEvent('idp.signin', 'failure', { reason: err.code, requestId });
      return {
        kind: 'redirect',
        location: ssoErrorRedirect(slug, providerErrorCode(err.code), requestId, organization),
      };
    }
    throw err; // unknown → root ErrorBoundary renders the branded page
  }

  switch (decision.kind) {
    case 'sign-in': {
      let setCookie: string;
      let target: string;
      let reauthClearCookie: string | undefined;
      try {
        ({ setCookie, target, reauthClearCookie } = await signInWithIdpIntent(provider, request, {
          idpIntentId: id,
          idpIntentToken: token,
          userId: decision.userId,
          requestId,
          organization,
          fallbackLoginName: intent.information.idpUserName,
          userAgent: userAgentFromRequest(request, fingerprintId),
          deviceTrackingToken,
        }));
      } catch (err) {
        if (err instanceof ProviderError) {
          deps.onAuthEvent?.('idp.signin', 'failure');
          logAuthEvent('idp.signin', 'failure', {
            userId: decision.userId,
            idpId: intent.information.idpId,
            requestId,
            reason: err.code,
          });
          return {
            kind: 'redirect',
            location: ssoErrorRedirect(slug, providerErrorCode(err.code), requestId, organization),
          };
        }
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
      const passkeyHintCookie = await serializePasskeyHint(intent.information.idpUserName);
      return {
        kind: 'redirect',
        location: target,
        setCookie,
        lastUsedCookie,
        passkeyHintCookie,
        fingerprintCookie: fingerprintCookie ?? undefined,
        reauthClearCookie,
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

        const metadata = deviceTrackingToken
          ? { [MAXMIND_TRACKING_TOKEN_METADATA_KEY]: deviceTrackingToken }
          : undefined;
        const session = await provider.createSession(
          { idpIntent: { idpIntentId: id, idpIntentToken: token } },
          {
            requestId,
            orgId: organization,
            userId: decision.userId,
            userAgent: userAgentFromRequest(request, fingerprintId),
            metadata,
          }
        );
        // Elide the post-create getUser(decision.userId) lookup — the cookie's
        // loginName is a display hint and intent.information.idpUserName already carries the
        // IdP-vouched login name (behavior-identical, one fewer RPC on the link/auto-link path).
        const loginName = intent.information.idpUserName;
        const next = addSession(
          entries,
          sessionEntryFromSession(session, { loginName, organization, requestId })
        );
        logAuthEvent('idp.link', 'success', {
          userId: decision.userId,
          idpId: decision.link.idpId,
          requestId,
          auto: decision.kind === 'auto-link',
        });
        // Thread the just-created session id so /authorize finishes the callback via
        // resolveOidc's explicit-sessionId hand-back (runCallback) instead of re-running
        // decideAuthorize — without it a prompt=select_account / prompt=login ceremony loops
        // straight back to /accounts (or /login). Mirrors the password path's hand-back.
        const target = authorizeHandbackTarget(requestId, session.id);
        const lastUsedCookie = await serializeLastUsedLogin(`idp:${decision.link.idpId}`);
        const passkeyHintCookie = await serializePasskeyHint(loginName);
        return {
          kind: 'redirect',
          location: target,
          setCookie: await serializeSessions(next),
          lastUsedCookie,
          passkeyHintCookie,
          fingerprintCookie: fingerprintCookie ?? undefined,
          reauthClearCookie: reauthClear,
        };
      } catch (err) {
        if (err instanceof ProviderError) {
          deps.onAuthEvent?.('idp.link', 'failure');
          logAuthEvent('idp.link', 'failure', {
            userId: decision.userId,
            reason: err.code,
            requestId,
          });
          // ALREADY_EXISTS means this IdP identity is already linked to a DIFFERENT
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
            location: ssoErrorRedirect(slug, reason, requestId, organization),
          };
        }
        throw err; // unknown → root ErrorBoundary
      }
    }

    case 'link-needs-auth': {
      logAuthEvent('idp.link.denied', 'failure', { reason: 'account-exists', requestId });
      // Accepted PII tradeoff: the IdP-vouched email pre-fills the "sign in to link" form, so it
      // rides in the /login redirect (Location header, browser history, proxy logs). Fine for UX;
      // swap to an opaque one-time token if strict PII minimization becomes a requirement.
      const qs = new URLSearchParams({ loginName: decision.email, notice: 'link-existing' });
      if (requestId) qs.set('requestId', requestId);
      if (organization) qs.set('organization', organization);
      // Clear any in-flight re-auth intent: this redirects to /login for a DIFFERENT (link-target)
      // identity, which would otherwise false-mismatch at the password step and abort the link flow.
      return {
        kind: 'redirect',
        location: `/login?${qs.toString()}`,
        reauthClearCookie: reauthClear,
      };
    }

    case 'auto-create': {
      // New IdP user: auto-create (email already verified by the IdP), link, and sign in
      // directly — no /signup/method hop needed.
      try {
        // GitHub (and some other IdPs) return no given/family name — often only the login.
        // Derive Zitadel-valid non-empty names (displayName split → idpUserName fallback) so
        // addHumanUser's profile.givenName/familyName length constraint is satisfied.
        const { firstName, lastName } = deriveIdpProfileName({
          firstName: decision.draft.firstName,
          lastName: decision.draft.lastName,
          displayName: decision.draft.displayName,
          idpUserName: decision.link.idpUserName,
        });
        // BUG 1 fix: pass callbackOrg (resolved default org) instead of raw organization
        // so addHumanUser always receives a concrete org. Raw organization is undefined on a
        // bare (no ?organization=) flow, which causes Zitadel's FAILED_PRECONDITION.
        const result = await registerAndLinkIdp(provider, entries, {
          email: decision.draft.email ?? '',
          firstName,
          lastName,
          organization: callbackOrg,
          requestId,
          idpId: decision.link.idpId,
          idpUserId: decision.link.idpUserId,
          idpUserName: decision.link.idpUserName,
          idpIntentId: id,
          idpIntentToken: token,
          emailVerified: intent.draft?.emailVerified ?? false,
          userAgent: userAgentFromRequest(request, fingerprintId),
          deviceTrackingToken,
        });
        const lastUsedCookie = await serializeLastUsedLogin(`idp:${decision.link.idpId}`);
        const passkeyHintCookie = result.loginName
          ? await serializePasskeyHint(result.loginName)
          : undefined;
        return {
          kind: 'redirect',
          location: result.target,
          setCookie: await serializeSessions(result.sessions),
          lastUsedCookie,
          passkeyHintCookie,
          fingerprintCookie: fingerprintCookie ?? undefined,
          reauthClearCookie: reauthClear,
        };
      } catch (err) {
        if (err instanceof ProviderError) {
          deps.onAuthEvent?.('idp.register', 'failure');
          logAuthEvent('idp.register', 'failure', { reason: err.code, requestId });
          // 755-K1: ALREADY_EXISTS here means the same-email collision pre-check (findUser)
          // missed a real account — mirrors the `link` branch's ALREADY_EXISTS handling above
          // (a distinct reason, not the generic providerErrorCode() signin_failed fallback) so
          // the user learns an account already exists instead of hitting a dead end.
          const reason =
            err.code === 'ALREADY_EXISTS' ? 'registration-conflict' : providerErrorCode(err.code);
          return {
            kind: 'redirect',
            location: ssoErrorRedirect(slug, reason, requestId, organization),
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
        location: ssoErrorRedirect(slug, decision.reason, requestId, organization),
      };
    }

    default: {
      const exhausted: never = decision;
      throw new Error(`Unhandled decision type: ${exhausted}`);
    }
  }
}
