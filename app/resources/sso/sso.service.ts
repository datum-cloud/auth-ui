// app/resources/sso/sso.service.ts
//
// Pass 2 extraction: the BUSINESS logic of the SSO surfaces —
//   • /sso              (loader: list linked/unlinked IdPs; action: unlink + start intent)
//   • /sso/link         (loader: session-gated link-intent start)
//   • /sso/ldap         (action: LDAP credential sign-in)
//   • /sso/:provider/callback (loader: resolve intent → decide → sign-in/link/register/error)
//
// React rendering and the final Response construction stay thin in the routes; this service
// describes WHAT each surface resolves to via a typed `SsoOutcome` plus an `outcomeToResponse`
// translator that turns it into the redirect/JSON/data Response the route returns verbatim.
//
// The seed flow modules (`idp-buttons`, `idp-callback`, `idp-return-urls`, `idp-session`,
// `saml-binding`) are re-exported through the barrel; this service builds the orchestration
// around them.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { idpTypeToSlug, slugToProvider } from '@/modules/auth/idp-slug';
import {
  readSessions,
  mostRecent,
  addSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { ProviderError } from '@/modules/auth/types';
import type { IdpIntentResult, IdpLink, IdProvider } from '@/modules/auth/types';
import { registerAndLinkIdp } from '@/resources/signup';
import { decideIdpCallback } from '@/resources/sso/idp-callback';
import { idpReturnUrls } from '@/resources/sso/idp-return-urls';
import { signInWithIdpIntent } from '@/resources/sso/idp-session';
import { trustedAppOrigin } from '@/server/app-origin.server';
import { logAuthEvent } from '@/server/observability';
import { userAgentFromRequest } from '@/server/user-agent';
import { providerErrorCode } from '@/utils/errors/auth-error';
import { data, redirect } from 'react-router';
import { z } from 'zod';

// ── Dependency-injection seams (CODE-MAJ-04 / CODE-MAJ-07) ──────────────────────
// Production calls never pass deps. Tests inject provider stubs + an event collector
// directly, avoiding module-level mocking of logAuthEvent.

export interface SsoActionDeps {
  startIdpIntent?: (
    idpId: string,
    urls: { success: string; failure: string }
  ) => Promise<{ authUrl?: string | null | undefined }>;
  onAuthEvent?: (event: string, outcome: 'success' | 'failure') => void;
}

export interface CallbackLoaderDeps {
  retrieveIdpIntent?: (id: string, token: string) => Promise<IdpIntentResult>;
  onAuthEvent?: (event: string, outcome: 'success' | 'failure') => void;
}

// ── Typed outcomes ──────────────────────────────────────────────────────────────
// `data` carries a `data()` payload (the route returns it verbatim — RR serializes it);
// `redirect` carries a Location + optional set-cookie; `response` carries a raw Response
// (used for plain 400 Bad Request and 502 data responses).

export type SsoOutcome =
  | { kind: 'redirect'; location: string; setCookie?: string; lastUsedCookie?: string }
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
      if (outcome.setCookie || outcome.lastUsedCookie) {
        const h = new Headers();
        if (outcome.setCookie) h.append('set-cookie', outcome.setCookie);
        if (outcome.lastUsedCookie) h.append('set-cookie', outcome.lastUsedCookie);
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

// ── helpers ─────────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

// ── /sso loader ─────────────────────────────────────────────────────────────────

export interface SsoManagementData {
  csrfToken: string;
  userId: string;
  loginName: string | null;
  linked: IdpLink[];
  unlinked: IdProvider[];
  allowUnlink: boolean;
}

export type SsoManagementResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'data'; data: SsoManagementData; setCookie: string | null };

/**
 * /sso loader logic. Lists the active IdPs, resolves the ceremony session (guarding a
 * transient ProviderError into a service_unavailable redirect), and shapes the
 * linked/unlinked split. Returns a redirect to /login when there is no session user.
 *
 * `getCsrfToken` is injected so the route can wire the request-scoped CSRF token without
 * the service depending on the server CSRF module directly.
 */
export async function resolveSsoManagement(
  provider: AuthProvider,
  request: Request,
  csrf: { token: string; setCookie: string | null }
): Promise<SsoManagementResult> {
  const url = new URL(request.url);
  const organization = url.searchParams.get('organization') ?? undefined;

  const active = provider.capabilities.externalIdp
    ? await provider.getActiveIdPs(organization)
    : [];

  const entries = await readSessions(request);
  const recent = mostRecent(entries);

  // CODE-MAJ-07: guard getSession so a transient ProviderError doesn't produce a raw 500.
  // On any provider failure redirect to /login — the user must re-authenticate.
  let session: Awaited<ReturnType<typeof provider.getSession>> | null;
  try {
    session = recent ? await provider.getSession(recent.id, recent.token) : null;
  } catch (err) {
    if (err instanceof ProviderError) {
      return { kind: 'redirect', location: '/error?code=service_unavailable' };
    }
    throw err; // unknown → root ErrorBoundary (CCD-10)
  }
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return { kind: 'redirect', location: '/login' };
  }

  // CODE-MIN-03: listIdpLinks now returns IdpLink[] — no cast needed.
  const links = await provider.listIdpLinks(userId);
  const linkedIds = new Set(links.map((l) => l.idpId));

  return {
    kind: 'data',
    data: {
      csrfToken: csrf.token,
      userId,
      loginName: session?.user?.loginName ?? null,
      linked: links,
      unlinked: active.filter((p) => !linkedIds.has(p.id)),
      allowUnlink: process.env.ALLOW_IDP_UNLINK === 'true',
    },
    setCookie: csrf.setCookie,
  };
}

// ── /sso action ─────────────────────────────────────────────────────────────────

const SsoActionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('unlink'),
    idpId: z.string().min(1),
    linkedUserId: z.string().min(1),
    // NOTE: any form `userId` is intentionally NOT read here — the user id comes
    // from the session only (security control).
  }),
  z.object({
    intent: z.literal('start'),
    provider: z.string().min(1),
    organization: z.string().optional(),
    linkOnly: z.string().optional(),
  }),
]);

/**
 * /sso action logic (unlink + start intent). CSRF must already be asserted by the route.
 * `form` is the parsed FormData. Returns a typed SsoOutcome the route translates verbatim.
 */
export async function runSsoAction(
  provider: AuthProvider,
  request: Request,
  form: FormData,
  deps: SsoActionDeps = {}
): Promise<SsoOutcome> {
  const parsed = SsoActionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { kind: 'response', response: new Response('Bad Request', { status: 400 }) };
  }
  const payload = parsed.data;

  if (payload.intent === 'unlink') {
    if (process.env.ALLOW_IDP_UNLINK !== 'true') {
      return { kind: 'response', response: new Response(null) }; // route returns null
    }

    const entries = await readSessions(request);
    const recent = mostRecent(entries);
    const session = recent ? await provider.getSession(recent.id, recent.token) : null;
    const userId = session?.user?.id;
    if (!userId) {
      return { kind: 'response', response: new Response(null) }; // never trust a form userId
    }

    // CODE-MAJ-07: guard removeIdpLink — on ProviderError return a 502 + failure event.
    try {
      await provider.removeIdpLink(userId, payload.idpId, payload.linkedUserId);
      logAuthEvent('idp.unlink', 'success', {
        userId,
        idpId: payload.idpId,
        linkedUserId: payload.linkedUserId,
      });
    } catch (err) {
      if (err instanceof ProviderError) {
        logAuthEvent('idp.unlink', 'failure', { userId, reason: err.code });
        return { kind: 'data', payload: { error: 'provider_error' }, status: 502 };
      }
      throw err; // unknown → root ErrorBoundary (CCD-10)
    }
    return { kind: 'redirect', location: '/sso' };
  }

  // intent === 'start'
  const activeIdPs = await provider.getActiveIdPs(payload.organization || undefined);
  const target = activeIdPs.find(
    (p) => p.id === payload.provider || slugify(p.name) === payload.provider
  );
  if (!target) return { kind: 'redirect', location: '/sso' };

  // P6 Task 9: LDAP-type IdPs use a dedicated credential-entry screen instead of
  // an external IdP redirect. Route to /sso/ldap with the idpId and any flow params.
  if (idpTypeToSlug(target.type) === 'ldap') {
    // Account-linking via LDAP is not yet supported — guard it here so the user
    // gets a clear error rather than a silent plain sign-in.
    // TODO(P7): wire LDAP link via retrieveIdpIntent information + addIdpLink
    if (payload.linkOnly === 'true') {
      return { kind: 'redirect', location: `/sso/ldap/error?reason=ldap-link-unsupported` };
    }

    const qs = new URLSearchParams({ idpId: target.id });
    if (payload.organization) qs.set('organization', payload.organization);
    return { kind: 'redirect', location: `/sso/ldap?${qs.toString()}` };
  }

  const origin = trustedAppOrigin(request);
  const slug = payload.provider;
  const { success, failure } = idpReturnUrls(origin, slug, {
    link: payload.linkOnly === 'true',
    organization: payload.organization || undefined,
  });

  // CODE-MAJ-07: guard startIdpIntent — on ProviderError redirect to the SSO error page
  // and emit a failure audit event. DI seam allows tests to stub the call directly.
  const doStartIdpIntent =
    deps.startIdpIntent ??
    ((idpId: string, urls: { success: string; failure: string }) =>
      provider.startIdpIntent(idpId, urls));

  let authUrl: string | null | undefined;
  try {
    const result = await doStartIdpIntent(target.id, { success, failure });
    authUrl = result.authUrl;
  } catch (err) {
    if (err instanceof ProviderError) {
      deps.onAuthEvent?.('idp_start', 'failure');
      logAuthEvent('idp_start', 'failure', { reason: err.code });
      return {
        kind: 'redirect',
        location: `/sso/${slug}/error?reason=${providerErrorCode(err.code)}`,
      };
    }
    throw err; // unknown → root ErrorBoundary (CCD-10)
  }

  if (!authUrl) {
    logAuthEvent('idp_start', 'failure', { reason: 'no_auth_url' });
    return { kind: 'redirect', location: '/sso' };
  }
  return { kind: 'redirect', location: authUrl };
}

// ── /sso/link loader ──────────────────────────────────────────────────────────────

export interface SsoLinkSignInRequired {
  mode: 'sign-in-required';
  providers: IdProvider[];
  returnTo: string;
}

export type SsoLinkResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'data'; data: SsoLinkSignInRequired };

/**
 * /sso/link loader logic. Session-gated: no session → render the sign-in-required prompt;
 * session but no specific provider → redirect to /sso; session + provider → start a link
 * intent and redirect to the IdP (or back to /sso on miss / empty authUrl).
 */
export async function resolveSsoLink(
  provider: AuthProvider,
  request: Request
): Promise<SsoLinkResult> {
  const url = new URL(request.url);
  const wantedSlug = url.searchParams.get('provider');
  const organization = url.searchParams.get('organization') ?? undefined;

  const entries = await readSessions(request);
  const recent = mostRecent(entries);
  const session = recent ? await provider.getSession(recent.id, recent.token) : null;

  // (c) No session → render sign-in-required prompt
  if (!session?.user?.id) {
    const active = provider.capabilities.externalIdp
      ? await provider.getActiveIdPs(organization)
      : [];
    return {
      kind: 'data',
      data: {
        mode: 'sign-in-required',
        providers: active,
        returnTo: url.pathname + url.search,
      },
    };
  }

  // (b) Session, no provider → redirect to /sso management screen
  if (!wantedSlug) {
    return { kind: 'redirect', location: '/sso' };
  }

  // (a) Session + specific provider → start link intent and redirect
  const active = provider.capabilities.externalIdp
    ? await provider.getActiveIdPs(organization)
    : [];
  const target = slugToProvider(wantedSlug, active);
  if (!target) {
    return { kind: 'redirect', location: '/sso' };
  }

  const origin = trustedAppOrigin(request);
  const { success, failure } = idpReturnUrls(origin, wantedSlug, { link: true, organization });
  const { authUrl } = await provider.startIdpIntent(target.id, { success, failure });

  logAuthEvent('idp.link.start', authUrl ? 'success' : 'failure', {
    idpId: target.id,
    userId: session.user.id,
    slug: wantedSlug,
  });

  return { kind: 'redirect', location: authUrl ? authUrl : '/sso' };
}

// ── /sso/ldap action ──────────────────────────────────────────────────────────────

export const ldapServerSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  idpId: z.string().min(1),
  requestId: z.string().optional(),
  organization: z.string().optional(),
});

/**
 * The error payload the /sso/ldap action surfaces to its component (via useActionData).
 * `INVALID_CREDENTIALS` / `ACCOUNT_NOT_LINKED` / `invalid_input` are recognized; any other
 * ProviderError code rides through as a generic string the component maps to a fallback.
 */
export type LdapActionData = { error: string };

/**
 * /sso/ldap action logic. Validates the full form, exchanges credentials for an LDAP intent,
 * maps ProviderErrors to typed data responses (401 INVALID_CREDENTIALS / 400 <code>), guards
 * the unlinked-user (empty userId) case into a typed 403 ACCOUNT_NOT_LINKED, and on success
 * mints a session via the shared signInWithIdpIntent helper. CSRF is asserted by the route.
 */
export async function submitLdapCredentials(
  provider: AuthProvider,
  request: Request,
  form: FormData
): Promise<SsoOutcome> {
  const parsed = ldapServerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    logAuthEvent('ldap_signin', 'failure', { reason: 'invalid_input' });
    return { kind: 'data', payload: { error: 'invalid_input' as const }, status: 400 };
  }

  const { idpId, username, requestId, organization } = parsed.data;

  let ldapIntent;
  try {
    ldapIntent = await provider.startLdapIntent(idpId, username, parsed.data.password);
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.code === 'INVALID_CREDENTIALS') {
        logAuthEvent('ldap_signin', 'failure', { reason: error.code, idpId });
        return { kind: 'data', payload: { error: 'INVALID_CREDENTIALS' as const }, status: 401 };
      }
      logAuthEvent('ldap_signin', 'failure', { reason: error.code, idpId });
      return { kind: 'data', payload: { error: error.code as string }, status: 400 };
    }
    throw error;
  }

  const { userId, idpIntentId, idpIntentToken } = ldapIntent;

  // Real Zitadel returns valid LDAP credentials with an empty userId when the IdP
  // user is NOT linked to any Zitadel account (the resolved intent is a 'register'
  // draft, not a sign-in). Proceeding to createSession throws [failed_precondition]
  // 'User ID missing' → an uncaught 500. Direct sign-in only supports already-linked
  // accounts; register-and-link via LDAP is deferred (see /sso ldap-link guard).
  // Fail gracefully with a typed error instead of leaking a 500.
  if (!userId) {
    logAuthEvent('ldap_signin', 'failure', { reason: 'account_not_linked', idpId });
    return { kind: 'data', payload: { error: 'ACCOUNT_NOT_LINKED' as const }, status: 403 };
  }

  const { setCookie, target } = await signInWithIdpIntent(provider, request, {
    idpIntentId,
    idpIntentToken,
    userId,
    requestId,
    organization,
    fallbackLoginName: username,
  });

  logAuthEvent('ldap_signin', 'success', { idpId, userId, requestId });

  return { kind: 'redirect', location: target, setCookie };
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
    return { kind: 'redirect', location: `/sso/${slug}/error?reason=context-missing` };
  }

  const { id, token, link, requestId, organization } = parsed.data;

  // CODE-MAJ-04: wrap the intent-fetch + session-resolution + decision block so a transient
  // ProviderError redirects to the branded error page and emits a failure audit event instead
  // of producing a raw 500. Unknown errors (non-ProviderError) re-throw so the root
  // ErrorBoundary (CCD-10) handles them.
  let intent: IdpIntentResult;
  let entries: Awaited<ReturnType<typeof readSessions>>;
  let decision: ReturnType<typeof decideIdpCallback>;

  try {
    intent = await doRetrieveIdpIntent(id, token);

    // Resolve the active ceremony user server-side — NEVER trust a client-supplied userId.
    entries = await readSessions(request);
    const recent = mostRecent(entries);
    let sessionUserId: string | null = null;
    if (recent) {
      // CODE-MIN-05: recent.id is a SESSION id, not a user id — getUser(recent.id) was
      // semantically wrong and a wasted call. Resolve the user directly from the session.
      try {
        const session = await provider.getSession(recent.id, recent.token);
        sessionUserId = session?.user?.id ?? null;
      } catch {
        // A stale/expired/invalid ceremony-session entry must not abort a fresh IdP sign-in.
        // (Zitadel getSession throws NOT_FOUND for an expired session.) Treat as no ceremony user.
        sessionUserId = null;
      }
    }

    const settings = await provider.getLoginSettings(organization);

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

    decision = decideIdpCallback({
      intent,
      link: link === 'true',
      sessionUserId,
      creationAllowed: settings.allowRegister,
      existingAccount,
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      deps.onAuthEvent?.('idp.signin', 'failure');
      logAuthEvent('idp.signin', 'failure', { reason: err.code, requestId });
      return {
        kind: 'redirect',
        location: `/sso/${slug}/error?reason=${providerErrorCode(err.code)}`,
      };
    }
    throw err; // unknown → root ErrorBoundary (CCD-10) renders the branded page
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
          userAgent: userAgentFromRequest(request),
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
      return { kind: 'redirect', location: target, setCookie, lastUsedCookie };
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
            userAgent: userAgentFromRequest(request),
          }
        );
        const user = await provider.getUser(decision.userId);
        const loginName = user?.loginName ?? intent.information.idpUserName;
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
        };
      } catch (err) {
        if (err instanceof ProviderError) {
          deps.onAuthEvent?.('idp.link', 'failure');
          logAuthEvent('idp.link', 'failure', {
            userId: decision.userId,
            reason: err.code,
            requestId,
          });
          return {
            kind: 'redirect',
            location: `/sso/${slug}/error?reason=${providerErrorCode(err.code)}`,
          };
        }
        throw err; // unknown → root ErrorBoundary (CCD-10)
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
          userAgent: userAgentFromRequest(request),
        });
        const lastUsedCookie = await serializeLastUsedLogin(`idp:${decision.link.idpId}`);
        return {
          kind: 'redirect',
          location: result.target,
          setCookie: await serializeSessions(result.sessions),
          lastUsedCookie,
        };
      } catch (err) {
        if (err instanceof ProviderError) {
          deps.onAuthEvent?.('idp.register', 'failure');
          logAuthEvent('idp.register', 'failure', { reason: err.code, requestId });
          return {
            kind: 'redirect',
            location: `/sso/${slug}/error?reason=${providerErrorCode(err.code)}`,
          };
        }
        throw err; // unknown → root ErrorBoundary (CCD-10)
      }
    }

    case 'error': {
      logAuthEvent('idp.link.denied', 'failure', {
        reason: decision.reason,
        idpId: intent.information.idpId,
        requestId,
      });
      return { kind: 'redirect', location: `/sso/${slug}/error?reason=${decision.reason}` };
    }

    default: {
      const exhausted: never = decision;
      throw new Error(`Unhandled decision type: ${exhausted}`);
    }
  }
}
