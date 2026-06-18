// app/resources/login/login.service.ts
//
// Pass 2 extraction: the loader/action BUSINESS logic for the login domain — the
// /login → /authorize protocol-bridge decision, the IdP-intent start (return-URL
// construction + provider.startIdpIntent + result mapping), the identifier flow
// (findUser → createSession → decideAfterIdentifier → ceremony-session shaping),
// and the password flow (session lookup → updateSession → nextStep routing with
// the /authorize finalization carve-out). React rendering, CSRF, cookie I/O and
// the final redirect()/data() wiring stay in the route modules.
//
// Each function takes a provider + plain inputs (already parsed/validated by the
// route's schema) + the caller's current session list, and returns a typed result
// the route turns into a redirect()/data() response. No Request parsing, no CSRF,
// no raw cookie serialization lives here.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { idpTypeToSlug } from '@/modules/auth/idp-slug';
import { addSession, byLoginName, type SessionEntry } from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import { decideAfterIdentifier } from '@/resources/login/login-decision';
import { isEmailLike } from '@/resources/login/login.schema';
import { nextStepWithParams } from '@/resources/shared/next-step-params';
import { idpReturnUrls } from '@/resources/sso/idp-return-urls';
import { logAuthEvent, hashActor } from '@/server/observability';

// ── /login → /authorize protocol bridge ───────────────────────────────────────

/**
 * Zitadel's login-v2 base URI appends `/login?authRequest=…` (OIDC) or
 * `?samlRequest=…` (SAML) — NOT `/authorize`. When either raw protocol entry is
 * present the loader must forward to the /authorize orchestrator, which normalizes
 * it to a requestId and threads the ceremony.
 *
 * Keyed on authRequest/samlRequest ONLY, so the post-identifier return from
 * /authorize (which carries `?requestId=`) never re-triggers this (no loop). A
 * plain /login (no protocol entry) is NOT bridged either.
 */
export function shouldBridgeToAuthorize(params: URLSearchParams): boolean {
  return params.has('authRequest') || params.has('samlRequest');
}

// ── IdP intent start ("Continue with Google") ─────────────────────────────────

export interface StartIdpInput {
  idpId: string;
  /**
   * TRUSTED app origin (scheme + host) from trustedAppOrigin(request). SECURITY:
   * MUST come from trusted config (PUBLIC_ORIGIN), never the client-controllable
   * request Host header — the IdP success/failure return URLs are built from it,
   * and Zitadel only accepts a registered (public-origin) redirect URI.
   */
  origin: string;
  /** Carried through the IdP round-trip so the /sso callback can resume /authorize. */
  requestId?: string;
  /** Org scope to carry through the ceremony. */
  organization?: string;
}

export type StartIdpError = 'IDP_UNAVAILABLE';

export type StartIdpResult = { ok: true; authUrl: string } | { ok: false; error: StartIdpError };

/**
 * Start an external-IdP intent. Builds the success/failure return URLs (threading
 * requestId + organization via the success URL so they survive the IdP round-trip
 * and arrive at the /sso callback), calls provider.startIdpIntent, and maps the
 * result. A missing authUrl is a provider failure → IDP_UNAVAILABLE (502 at route).
 */
export async function startIdpIntent(
  provider: AuthProvider,
  { idpId, origin, requestId, organization }: StartIdpInput
): Promise<StartIdpResult> {
  const slug = idpTypeToSlug(idpId) ?? idpId;
  const { success, failure } = idpReturnUrls(origin, slug, { requestId, organization });
  const result = await provider.startIdpIntent(idpId, { success, failure });
  if (!result.authUrl) {
    logAuthEvent('idp_start', 'failure', { idpId, reason: 'no_auth_url' });
    return { ok: false, error: 'IDP_UNAVAILABLE' };
  }
  logAuthEvent('idp_start', 'success', { idpId });
  return { ok: true, authUrl: result.authUrl };
}

// ── identifier flow ────────────────────────────────────────────────────────────

export interface ResolveIdentifierInput {
  loginName: string;
  requestId?: string;
  organization?: string;
  emailDeliveryEnabled: boolean;
}

export type ResolveIdentifierError = 'USER_NOT_FOUND' | 'EMAIL_LOGIN_DISABLED';

/**
 * A "identifier accepted, persist the ceremony session and redirect to the next
 * factor screen" outcome. The route serializes `sessions` into the cookie and
 * `redirect()`s to `target?<params>`.
 */
export interface ResolveIdentifierRedirect {
  ok: true;
  target: string;
  params: URLSearchParams;
  sessions: SessionEntry[];
}

export type ResolveIdentifierResult =
  | ResolveIdentifierRedirect
  | { ok: false; error: ResolveIdentifierError };

/** Lowercased domain of an email-style identifier, or null when it is not an email. */
function emailDomain(loginName: string): string | null {
  const at = loginName.lastIndexOf('@');
  if (at <= 0 || at === loginName.length - 1) return null;
  return loginName.slice(at + 1).toLowerCase();
}

/**
 * Identifier step: resolve the user, create the ceremony session, decide the next
 * factor screen, and shape the ceremony-session entry + threaded query params.
 *
 * Enumeration note (Phase 1): an unknown identifier surfaces a generic USER_NOT_FOUND
 * (the route renders generic copy); register/ignoreUnknown handled in Phase 2.
 *
 * The threaded `requestId` (oidc_/saml_/device_) rides on the redirect params so the
 * next screen — and ultimately /authorize — can resume the ceremony.
 */
export async function resolveIdentifier(
  provider: AuthProvider,
  list: SessionEntry[],
  { loginName, requestId, organization, emailDeliveryEnabled }: ResolveIdentifierInput
): Promise<ResolveIdentifierResult> {
  // allowDomainDiscovery (settings-gated, DEFAULT-OFF): when the caller pinned no org and the
  // BASE/instance policy enables discovery, map an email domain → org and thread it through the
  // rest of the ceremony. The base settings (getLoginSettings(undefined)) govern WHETHER discovery
  // runs — the org isn't known yet — and the discovered org's settings re-drive the gating below.
  // Off / explicit-org / non-email / no-hit ⇒ org stays === the caller's organization, i.e.
  // byte-identical to today.
  let org = organization;
  if (!org) {
    const baseSettings = await provider.getLoginSettings(undefined);
    if (baseSettings.allowDomainDiscovery === true) {
      const domain = emailDomain(loginName);
      const found = domain ? await provider.findOrgByDomain(domain) : null;
      if (found) {
        org = found.orgId;
        // Single auto-redirect IdP: the discovered org disallows password but exposes exactly
        // one external IdP → route straight to that IdP intent (skip the identifier/password screen).
        const orgSettings = await provider.getLoginSettings(org);
        const idps = await provider.getActiveIdPs(org);
        if (!orgSettings.allowPassword && orgSettings.allowExternalIdp && idps.length === 1) {
          logAuthEvent('identifier', 'success', { actor: hashActor(loginName) });
          const idpParams = new URLSearchParams({
            loginName,
            idpId: idps[0].id,
            organization: org,
          });
          if (requestId) idpParams.set('requestId', requestId);
          return { ok: true, target: '/sso', params: idpParams, sessions: list };
        }
      }
    }
  }

  const user = await provider.findUser(loginName, org);
  if (!user) {
    // ignoreUnknownUsernames (settings-gated, DEFAULT-OFF): with the flag off this is
    // byte-identical to before (USER_NOT_FOUND). With it on, proceed to the password
    // step bound to the typed loginName but with NO user attached — the credential check
    // then fails generically, identical to a wrong password for a real account.
    const settings = await provider.getLoginSettings(org);
    if (settings.ignoreUnknownUsernames !== true) {
      // disableLoginWithEmail (settings-gated, DEFAULT-OFF): an email is never a valid loginname
      // under this policy, so the lookup already failed. Refine the generic not-found into a
      // distinct EMAIL_LOGIN_DISABLED so the route can guide the user to their username.
      // isEmailLike is copy-only (never blocks) — see login.schema.ts. Gated behind the
      // ignoreUnknownUsernames check above so the anti-enumeration path reveals nothing.
      if (settings.disableLoginWithEmail === true && isEmailLike(loginName)) {
        logAuthEvent('identifier', 'failure', {
          actor: hashActor(loginName),
          reason: 'email_login_disabled',
        });
        return { ok: false, error: 'EMAIL_LOGIN_DISABLED' };
      }
      logAuthEvent('identifier', 'failure', { actor: hashActor(loginName), reason: 'not_found' });
      return { ok: false, error: 'USER_NOT_FOUND' };
    }
    logAuthEvent('identifier', 'success', { actor: hashActor(loginName) });
    const ghostSession = await provider.createSession({}, { requestId, orgId: org });
    const ghostSessions = addSession(list, {
      id: ghostSession.id,
      token: ghostSession.token,
      loginName,
      organization: org,
      creationTs: ghostSession.changedAt,
      expirationTs: ghostSession.expiresAt,
      changeTs: ghostSession.changedAt,
      requestId,
    });
    const ghostParams = new URLSearchParams({ loginName });
    if (requestId) ghostParams.set('requestId', requestId);
    if (org) ghostParams.set('organization', org);
    return { ok: true, target: '/login/password', params: ghostParams, sessions: ghostSessions };
  }
  logAuthEvent('identifier', 'success', { actor: hashActor(loginName) });

  const session = await provider.createSession({}, { requestId, orgId: org, userId: user.id });
  const methods = await provider.listAuthMethods(user.id);
  const settings = await provider.getLoginSettings(org);
  const decision = decideAfterIdentifier({ methods, settings, emailDeliveryEnabled });

  // Persist the ceremony session into the (to-be-serialized) cookie list.
  const sessions = addSession(list, {
    id: session.id,
    token: session.token,
    loginName: user.loginName,
    organization: org,
    creationTs: session.changedAt,
    expirationTs: session.expiresAt,
    changeTs: session.changedAt,
    requestId,
  });

  const params = new URLSearchParams({ loginName: user.loginName });
  if (requestId) params.set('requestId', requestId);
  if (org) params.set('organization', org);
  Object.entries(decision.params ?? {}).forEach(([k, v]) => params.set(k, v));

  return { ok: true, target: decision.target, params, sessions };
}

// ── password flow ───────────────────────────────────────────────────────────────

export interface VerifyLoginPasswordInput {
  password: string;
  loginName: string;
  requestId?: string;
  organization?: string;
}

export type VerifyLoginPasswordError = 'SESSION_EXPIRED' | 'INVALID_CREDENTIALS';

/**
 * A "password verified, persist the (possibly rotated) session and redirect"
 * outcome. The route serializes `sessions` into the cookie and `redirect()`s to
 * `target`.
 */
export interface VerifyLoginPasswordRedirect {
  ok: true;
  target: string;
  sessions: SessionEntry[];
}

export interface VerifyLoginPasswordCredentialFailure {
  ok: false;
  error: 'INVALID_CREDENTIALS';
  failedAttempts?: number;
  maxAttempts?: number;
}

export type VerifyLoginPasswordResult =
  | VerifyLoginPasswordRedirect
  | { ok: false; error: 'SESSION_EXPIRED' }
  | VerifyLoginPasswordCredentialFailure;

/**
 * Password step: look up the ceremony session entry (by loginName, from the SIGNED
 * cookie — the route supplies the list), verify the password via updateSession,
 * then resolve the next step.
 *
 * TOKEN ROTATION: Zitadel may issue a new token on setSession; we write the
 * (potentially rotated) token back to the ceremony entry so any subsequent
 * getSession / createCallback / deleteSession call uses the live token.
 *
 * /authorize carve-out: when nextStep resolves to /signed-in (fully authenticated)
 * AND a requestId is present, the session must be finalized via /authorize instead
 * (which calls createCallback and redirects back to the OIDC client). We surface the
 * authorize target with the same persisted session list.
 *
 * INVALID_CREDENTIALS is mapped to a typed failure (carrying failed/max attempts);
 * other ProviderErrors re-throw. Never logs the password.
 */
export async function verifyLoginPassword(
  provider: AuthProvider,
  list: SessionEntry[],
  { password, loginName, requestId, organization }: VerifyLoginPasswordInput
): Promise<VerifyLoginPasswordResult> {
  const entry = byLoginName(list, loginName, organization);
  if (!entry) return { ok: false, error: 'SESSION_EXPIRED' };

  let session;
  try {
    session = await provider.updateSession(entry.id, entry.token, { password });
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'INVALID_CREDENTIALS') {
      // Emit failure event — never log the password.
      logAuthEvent('password_check', 'failure', { actor: hashActor(loginName) });
      return {
        ok: false,
        error: 'INVALID_CREDENTIALS',
        failedAttempts: error.detail?.failedAttempts,
        maxAttempts: error.detail?.maxAttempts,
      };
    }
    throw error;
  }

  logAuthEvent('password_check', 'success', { userId: session.user?.id, sessionId: session.id });

  const userId = session.user?.id ?? '';
  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(organization),
  ]);

  // TOKEN ROTATION — write the (potentially rotated) token back to the ceremony entry.
  const sessions = addSession(list, {
    ...entry,
    token: session.token,
    changeTs: session.changedAt,
    expirationTs: session.expiresAt,
  });

  // Derive userVerified + mfaInitSkippedAt so the composed nextStep engine can
  // evaluate the full MFA decision tree (passkey UV + enrolled methods).
  const userVerified = session.factors.passkey?.userVerified ?? false;
  const mfaInitSkippedAt = session.user?.mfaInitSkippedAt ?? null;

  const targetUrl = nextStepWithParams({
    factors: session.factors,
    settings,
    enrolledMethods: methods,
    loginName,
    userVerified,
    mfaInitSkippedAt,
    requestId,
    organization,
  });

  // /authorize finalization carve-out (see doc above).
  const isSignedIn = targetUrl === '/signed-in' || targetUrl.startsWith('/signed-in?');
  if (isSignedIn && requestId) {
    const authorizeParams = new URLSearchParams({ requestId, sessionId: session.id });
    return { ok: true, target: `/authorize?${authorizeParams.toString()}`, sessions };
  }

  return { ok: true, target: targetUrl, sessions };
}

// Re-exported so callers/tests can reach the identifier decision through the barrel.
export { decideAfterIdentifier };
