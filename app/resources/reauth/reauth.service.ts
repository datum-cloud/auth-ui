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
import { ProviderError } from '@/modules/auth/types';
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

  const session = await provider.getSession(entry.id, entry.token);
  if (!session) return { kind: 'redirect', target: paths.login.index() };

  const userId = session.user?.id ?? (await provider.findUser(entry.loginName))?.id;
  if (!userId) return { kind: 'redirect', target: paths.login.index() };

  const enrolled = await provider.listAuthMethods(userId);
  const methods: ReauthMethod[] = [];
  if (enrolled.includes('passkey') && provider.capabilities.passkey) methods.push('passkey');
  if (enrolled.includes('password')) methods.push('password');
  if (enrolled.includes('otp_email') && input.emailDeliveryEnabled) methods.push('otp_email');

  const returnTo = validateReturnTo(input.returnTo) ?? paths.passkeys();

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
