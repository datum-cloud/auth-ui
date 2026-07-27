// app/resources/reauth/reauth.service.ts
//
// Sudo re-auth: verify ONE enrolled factor onto the EXISTING session
// (SetSession semantics — updateSession stamps the factor's verifiedAt and rotates
// the token, exactly like the login credential checks). This module NEVER touches
// login-decision.ts / next-step routing: the destination is always the validated
// returnTo (default /passkeys).
import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { SessionChecks } from '@/modules/auth/auth-provider';
// NOTE: import the PURE helpers from session/session (not cookie.ts) — cookie.ts is
// stubbed to no-ops in the Cypress component bundle; the pure module is browser-safe
// and identical at runtime (cookie.ts re-exports it).
import { mostRecent, addSession, type SessionEntry } from '@/modules/auth/session/session';
import type { Session } from '@/modules/auth/types';
import { ProviderError, isStaleSessionError } from '@/modules/auth/types';
import { postLoginDestinationWithSource } from '@/resources/login/post-login-destination';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { validateReturnTo } from '@/resources/shared/return-to';
import { paths } from '@/routes/paths';
import { logAuthEvent, hashActor } from '@/server/observability';

export type ReauthMethod = 'passkey' | 'password' | 'otp_email';

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
    };

/**
 * Same admin console → Zitadel default → env default priority /signed-in uses
 * (postLoginDestinationWithSource), falling back to /passkeys only when nothing is
 * configured at all. Best-effort: a failed settings/admin-check read degrades to
 * the /passkeys fallback rather than failing the whole reauth load.
 */
async function resolveDefaultReturnTo(
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
  };
}

export interface ReauthPerformInput {
  factor: ReauthMethod;
  /** Raw JSON string of the assertion credential (factor='passkey'). */
  credential?: string;
  password?: string;
  code?: string;
  returnTo: string | null;
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
  } else {
    if (!input.credential) return { ok: false, error: 'INVALID_INPUT' };
    let credentialAssertionData: unknown;
    try {
      credentialAssertionData = JSON.parse(input.credential);
    } catch {
      return { ok: false, error: 'INVALID_INPUT' };
    }
    checks = { webAuthN: { credentialAssertionData } };
  }

  let session: Session;
  try {
    session = await provider.updateSession(entry.id, entry.token, checks);
  } catch (err) {
    logAuthEvent('reauth', 'failure', {
      actor: hashActor(entry.loginName),
      factor: input.factor,
    });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
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

  return { ok: true, target: validateReturnTo(input.returnTo) ?? paths.passkeys(), sessions: next };
}
