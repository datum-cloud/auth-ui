// app/resources/reauth/reauth.service.ts
//
// Sudo re-auth: verify ONE enrolled factor onto the EXISTING session
// (SetSession semantics — updateSession stamps the factor's verifiedAt and rotates
// the token, exactly like the login credential checks). This module NEVER touches
// login-decision.ts / next-step routing: the destination is always the validated
// returnTo (default /passkeys).
import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { SessionChecks } from '@/modules/auth/auth-provider';
import { idpTypeToSlug } from '@/modules/auth/idp-slug';
// NOTE: import the PURE helpers from session/session (not cookie.ts) — cookie.ts is
// stubbed to no-ops in the Cypress component bundle; the pure module is browser-safe
// and identical at runtime (cookie.ts re-exports it).
import { mostRecent, addSession, type SessionEntry } from '@/modules/auth/session/session';
import type { Session } from '@/modules/auth/types';
import { ProviderError, isStaleSessionError } from '@/modules/auth/types';
import { withLoginHint } from '@/resources/login/login.service';
import { postLoginDestinationWithSource } from '@/resources/login/post-login-destination';
import { APP_BASENAME } from '@/resources/shared/app-basename';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { validateReturnTo } from '@/resources/shared/return-to';
import { joinLinkedIdps } from '@/resources/sso';
import { getActiveIdPs } from '@/resources/sso/idp-providers';
import { paths } from '@/routes/paths';
import { logAuthEvent, hashActor } from '@/server/observability';

export type ReauthMethod = 'passkey' | 'password' | 'otp_email' | 'idp';

/** A redirect-based (OAuth/OIDC) IdP the user can reauth with. LDAP is excluded — it needs
 *  its own credential form, not an OAuth round-trip (see sso/ldap.tsx). */
export interface ReauthLinkedIdp {
  idpId: string;
  name?: string;
  type?: string;
  logoUrl?: string;
}

export interface ReauthLoadInput {
  returnTo: string | null;
  method: ReauthMethod | null;
  /** Request hostname — the FIDO2 relying-party domain for the assertion challenge. */
  domain: string;
  emailDeliveryEnabled: boolean;
  /** `${ZITADEL_API_URL}/ui/console` — where instance admins land when returnTo is unset. */
  consoleUrl: string;
  /** DEFAULT_APP_URL env — fallback when Zitadel has no default configured. */
  defaultAppUrl?: string;
}

export type ReauthLoadResult =
  | { kind: 'redirect'; target: string }
  | {
      kind: 'view';
      loginName: string;
      methods: ReauthMethod[];
      method: ReauthMethod | null;
      publicKeyCredentialRequestOptions: unknown;
      returnTo: string;
      linkedIdps: ReauthLinkedIdp[];
    };

/**
 * Same admin console → Zitadel default → env default priority /signed-in uses
 * (postLoginDestinationWithSource), falling back to /passkeys only when nothing is
 * configured at all. Best-effort: a failed settings/admin-check read degrades to
 * the /passkeys fallback rather than failing the whole reauth load.
 */
export async function resolveDefaultReturnTo(
  provider: AuthProvider,
  entry: SessionEntry,
  input: Pick<ReauthLoadInput, 'consoleUrl' | 'defaultAppUrl'>
): Promise<string> {
  const [settings, isAdmin] = await Promise.all([
    provider
      .getLoginSettings(entry.organization ?? (await resolveOrg(provider)))
      .catch(() => ({}) as { defaultRedirectUri?: string }),
    provider.isInstanceAdmin({ id: entry.id, token: entry.token }).catch(() => false),
  ]);
  const { dest } = postLoginDestinationWithSource({
    isAdmin,
    consoleUrl: input.consoleUrl,
    defaultRedirectUri: settings.defaultRedirectUri,
    defaultAppUrl: input.defaultAppUrl,
  });
  return dest ?? paths.passkeys();
}

/**
 * Resolve the reauth view: enrolled-methods chooser (constrained to reauth-capable
 * factors) or a single-method verify screen. No session → bounce to /login.
 * When method='passkey', request the assertion challenge on the EXISTING session
 * (non-fatal on failure — null options, mirroring requestWebAuthnChallenge).
 * When method='otp_email', request an emailed code the same way.
 */
export async function loadReauth(
  provider: AuthProvider,
  sessions: SessionEntry[],
  input: ReauthLoadInput
): Promise<ReauthLoadResult> {
  const entry = mostRecent(sessions);
  if (!entry) return { kind: 'redirect', target: paths.login.index() };

  // The stored session token may belong to a DIFFERENT browser/tab than the one hitting this
  // route right now, and may be stale or revoked provider-side. getSession/findUser/listAuthMethods
  // throw (rather than returning null) when that's the case — treat any non-transient
  // ProviderError the same as a null session: bounce to /login instead of crashing the request.
  // A genuinely transient error (real backend outage) still propagates.
  let userId: string | undefined;
  let enrolled: Awaited<ReturnType<typeof provider.listAuthMethods>>;
  try {
    const session = await provider.getSession(entry.id, entry.token);
    if (!session) return { kind: 'redirect', target: paths.login.index() };
    userId = session.user?.id ?? (await provider.findUser(entry.loginName))?.id;
    if (!userId) return { kind: 'redirect', target: paths.login.index() };
    enrolled = await provider.listAuthMethods(userId);
  } catch (err) {
    if (isStaleSessionError(err)) {
      logAuthEvent('reauth', 'failure', {
        actor: hashActor(entry.loginName),
        reason: err instanceof ProviderError ? err.code : 'UNKNOWN',
      });
      return { kind: 'redirect', target: paths.login.index() };
    }
    throw err;
  }

  const methods: ReauthMethod[] = [];
  if (enrolled.includes('passkey') && provider.capabilities.passkey) methods.push('passkey');
  if (enrolled.includes('password')) methods.push('password');
  if (enrolled.includes('otp_email') && input.emailDeliveryEnabled) methods.push('otp_email');

  // idp: only redirect-based (non-LDAP) linked providers count — LDAP needs its own
  // credential form (sso/ldap.tsx), not an OAuth round-trip.
  let linkedIdps: ReauthLinkedIdp[] = [];
  if (enrolled.includes('idp')) {
    const [links, active] = await Promise.all([
      provider.listIdpLinks(userId),
      getActiveIdPs(provider, await resolveOrg(provider, entry.organization)),
    ]);
    // joinLinkedIdps always sets a `logoUrl` key (even when the matched provider has none),
    // which would otherwise leave `logoUrl: undefined` as an own enumerable property — harmless
    // at runtime, but it trips up strict deep-equal assertions on the chooser payload. Drop it
    // when absent instead of forwarding the key.
    linkedIdps = joinLinkedIdps(links, active)
      .filter((l) => l.type !== 'LDAP')
      .map(({ logoUrl, ...rest }) => (logoUrl === undefined ? rest : { ...rest, logoUrl }));
    if (linkedIdps.length > 0) methods.push('idp');
  }

  // No caller-supplied returnTo (or a tampered one) — resolve the SAME post-login
  // destination /signed-in uses (admin console → Zitadel default → env default),
  // rather than blindly landing every reauth on /passkeys regardless of which flow
  // sent the user here. Only done when actually needed — the common case (an explicit
  // returnTo from the caller) skips these extra provider calls entirely.
  const returnTo =
    validateReturnTo(input.returnTo) ?? (await resolveDefaultReturnTo(provider, entry, input));

  let publicKeyCredentialRequestOptions: unknown = null;
  if (input.method === 'passkey') {
    try {
      const updated = await provider.updateSession(entry.id, entry.token, {
        challenges: { webAuthN: { domain: input.domain, userVerificationRequirement: 'required' } },
      });
      publicKeyCredentialRequestOptions =
        updated.challenges?.webAuthN?.publicKeyCredentialRequestOptions ?? null;
    } catch {
      logAuthEvent('reauth_challenge', 'failure', { actor: hashActor(entry.loginName) });
      // Non-fatal — the button surfaces an error on click.
    }
  } else if (input.method === 'otp_email') {
    try {
      await provider.updateSession(entry.id, entry.token, {
        challenges: { otpEmail: { kind: 'send' } },
      });
    } catch {
      logAuthEvent('reauth_challenge', 'failure', { actor: hashActor(entry.loginName) });
      // Non-fatal — the user can retry from the form.
    }
  }

  return {
    kind: 'view',
    loginName: entry.loginName,
    methods,
    method: input.method,
    publicKeyCredentialRequestOptions,
    returnTo,
    linkedIdps,
  };
}

export interface ReauthPerformInput {
  factor: ReauthMethod;
  /** Raw JSON string of the assertion credential (factor='passkey'). */
  credential?: string;
  password?: string;
  code?: string;
  /** factor='idp' — resolved from the IdP callback's ?id=&token= query params. */
  idpIntentId?: string;
  idpIntentToken?: string;
  returnTo: string | null;
  /** Same context loadReauth's resolveDefaultReturnTo needs — used ONLY to re-resolve the
   *  configured destination server-side when `returnTo` doesn't validate (never trust an
   *  absolute URL echoed back from the client, even one the server itself set moments ago). */
  consoleUrl: string;
  defaultAppUrl?: string;
}

export type ReauthPerformResult =
  | { ok: true; target: string; sessions: SessionEntry[] }
  | { ok: false; error: 'SESSION_EXPIRED' | 'INVALID_INPUT' | 'INVALID_CREDENTIALS' };

/**
 * Verify the posted factor onto the EXISTING session. Server-side enforcement point:
 * the session token comes from the signed cookie, never client input. On success the
 * rotated token is written back into the sessions list (returned for the route to
 * serialize) and the target is the re-validated returnTo.
 */
export async function performReauth(
  provider: AuthProvider,
  sessions: SessionEntry[],
  input: ReauthPerformInput
): Promise<ReauthPerformResult> {
  const entry = mostRecent(sessions);
  if (!entry) {
    logAuthEvent('reauth', 'failure', { reason: 'session_expired' });
    return { ok: false, error: 'SESSION_EXPIRED' };
  }

  let checks: SessionChecks;
  if (input.factor === 'password') {
    if (!input.password) return { ok: false, error: 'INVALID_INPUT' };
    checks = { password: input.password };
  } else if (input.factor === 'otp_email') {
    if (!input.code) return { ok: false, error: 'INVALID_INPUT' };
    checks = { otpEmail: input.code };
  } else if (input.factor === 'idp') {
    if (!input.idpIntentId || !input.idpIntentToken) return { ok: false, error: 'INVALID_INPUT' };
    checks = {
      idpIntent: { idpIntentId: input.idpIntentId, idpIntentToken: input.idpIntentToken },
    };
  } else if (input.factor === 'passkey') {
    if (!input.credential) return { ok: false, error: 'INVALID_INPUT' };
    let credentialAssertionData: unknown;
    try {
      credentialAssertionData = JSON.parse(input.credential);
    } catch {
      return { ok: false, error: 'INVALID_INPUT' };
    }
    checks = { webAuthN: { credentialAssertionData } };
  } else {
    const exhaustive: never = input.factor;
    return exhaustive;
  }

  let session: Session;
  try {
    session = await provider.updateSession(entry.id, entry.token, checks);
  } catch (err) {
    logAuthEvent('reauth', 'failure', {
      actor: hashActor(entry.loginName),
      factor: input.factor,
    });
    // The stored session token may belong to a DIFFERENT browser/tab than the one hitting this
    // route right now, and may be stale or revoked provider-side (same recovery loadReauth
    // already applies to its own getSession/listAuthMethods calls) — this updateSession call is
    // a THIRD site with the identical failure mode and, unlike loadReauth, previously had no
    // isStaleSessionError guard, so a stale cross-browser token rethrew uncaught into a 500 here
    // and at /reauth/:provider/callback's mid-OAuth return.
    if (isStaleSessionError(err)) {
      return { ok: false, error: 'SESSION_EXPIRED' };
    }
    if (
      err instanceof ProviderError &&
      (err.code === 'INVALID_CREDENTIALS' ||
        // Real Zitadel rejects an idpIntent verified against a DIFFERENT user with
        // FAILED_PRECONDITION ("Intent meant for another user"), not INVALID_CREDENTIALS —
        // scoped to the idp factor only, since FAILED_PRECONDITION means something else
        // entirely for the other factors.
        (input.factor === 'idp' && err.code === 'FAILED_PRECONDITION'))
    ) {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }
    throw err;
  }

  logAuthEvent('reauth', 'success', { sessionId: session.id, factor: input.factor });

  // Token-rotation write-back — same session id, new token (SetSession semantics).
  const next = addSession(sessions, {
    ...entry,
    token: session.token,
    changeTs: session.changedAt,
    expirationTs: session.expiresAt,
  });

  // Never trust an absolute URL echoed back from the client, even one the server itself
  // set as loadReauth's resolved default moments ago — re-derive it server-side instead of
  // falling back to a hardcoded /passkeys, which silently dropped the configured
  // destination (admin console / Zitadel default / env default) whenever it wasn't on
  // POST_LOGOUT_ALLOWLIST (a different allowlist, for a different purpose).
  // Use the JUST-ROTATED token (session.token), not entry's pre-rotation one — updateSession
  // above may have rotated it (SetSession semantics), and resolveDefaultReturnTo's
  // isInstanceAdmin check would otherwise silently fail (.catch(() => false)) against the
  // now-superseded token, misclassifying an admin as non-admin and landing them on the wrong
  // default destination.
  const target =
    validateReturnTo(input.returnTo) ??
    (await resolveDefaultReturnTo(
      provider,
      { ...entry, token: session.token },
      {
        consoleUrl: input.consoleUrl,
        defaultAppUrl: input.defaultAppUrl,
      }
    ));

  return { ok: true, target, sessions: next };
}

export interface StartReauthIdpInput {
  idpId: string;
  /** TRUSTED app origin from trustedAppOrigin(request) — never the raw request Host header. */
  origin: string;
  /** Where to land after a successful reauth (already validated by the caller). */
  returnTo: string;
  /**
   * Best-effort pre-selection: the identity being re-authenticated (mirrors
   * login.service.ts's startIdpIntent's reauthHint). On reauth, picking the wrong Google
   * account is MORE likely than on a fresh login (the user is already signed in as someone
   * specific) and fails loudly with FAILED_PRECONDITION — cheap UX win, never load-bearing
   * (the callback's identity-mismatch check is the real guard).
   */
  loginHint?: string;
}

export type StartReauthIdpResult =
  { ok: true; authUrl: string } | { ok: false; error: 'IDP_UNAVAILABLE' };

/** Build the /reauth/:provider/callback + /reauth/:provider/error return URLs — the reauth
 *  analog of sso's idpReturnUrls, pointed at the dedicated reauth callback instead. */
function reauthIdpReturnUrls(
  origin: string,
  slug: string,
  returnTo: string
): { success: string; failure: string } {
  const qs = `returnTo=${encodeURIComponent(returnTo)}`;
  const base = `${origin}${APP_BASENAME}/reauth/${encodeURIComponent(slug)}`;
  return { success: `${base}/callback?${qs}`, failure: `${base}/error?${qs}` };
}

/**
 * Start a fresh OAuth round-trip to re-verify the CURRENT session's identity via one of
 * its linked IdPs (the 'idp' reauth method). Mirrors login.service.ts's startIdpIntent —
 * same try/catch shape, same IDP_UNAVAILABLE mapping — but points the return URLs at the
 * dedicated /reauth/:provider/callback|error routes instead of /sso/:provider/....
 */
export async function startReauthIdpIntent(
  provider: AuthProvider,
  { idpId, origin, returnTo, loginHint }: StartReauthIdpInput
): Promise<StartReauthIdpResult> {
  const slug = idpTypeToSlug(idpId) ?? idpId;
  const { success, failure } = reauthIdpReturnUrls(origin, slug, returnTo);
  let result: Awaited<ReturnType<typeof provider.startIdpIntent>>;
  try {
    result = await provider.startIdpIntent(idpId, { success, failure });
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    logAuthEvent('reauth_idp_start', 'failure', { idpId, reason: 'provider_error' });
    return { ok: false, error: 'IDP_UNAVAILABLE' };
  }
  if (!result.authUrl) {
    logAuthEvent('reauth_idp_start', 'failure', { idpId, reason: 'no_auth_url' });
    return { ok: false, error: 'IDP_UNAVAILABLE' };
  }
  logAuthEvent('reauth_idp_start', 'success', { idpId });
  return { ok: true, authUrl: withLoginHint(result.authUrl, loginHint) };
}
