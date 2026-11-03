// app/resources/password/password.service.ts
//
// Pass 2 extraction: the loader/action BUSINESS logic for the password domain
// (token/url-template construction, enumeration-safe reset dispatch, provider
// password calls, and ProviderError → typed-error mapping). React rendering and
// the route's redirect()/data() wiring stay in the route modules.
//
// Every function is pure in the sense that it takes a provider + plain inputs and
// returns a typed result; no Request parsing, no CSRF, no cookie I/O lives here.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { PasswordComplexity } from '@/modules/auth/types';
import { ProviderError, isStaleSessionError } from '@/modules/auth/types';
import {
  changePasswordSchema,
  changePasswordSchemaFor,
  newPasswordSchema,
  newPasswordSchemaFor,
  resetRequestSchema,
} from '@/resources/password/password.schema';
import { isSudoFresh } from '@/resources/shared/sudo';
import { verifyUrlTemplate } from '@/resources/verify/verify-url-template';
import { paths } from '@/routes/paths';
import { logAuthEvent, hashActor } from '@/server/observability';
import { constantTimeNoop } from '@/server/timing';

// ── reset (request a reset email) ─────────────────────────────────────────────

export interface RequestPasswordResetInput {
  loginName: string;
  organization?: string;
  /**
   * TRUSTED app origin (scheme + host), e.g. from trustedAppOrigin(request).
   * SECURITY: this MUST come from trusted config (PUBLIC_ORIGIN), never the
   * client-controllable request Host header — otherwise an attacker could redirect
   * a victim's reset link (and the real reset code + userId) to their own host.
   */
  origin: string;
  /** Carried through so the post-reset step can resume an OIDC/SAML ceremony. */
  requestId?: string;
}

/**
 * Enumeration-safe password-reset dispatch.
 *
 * Builds the URL template the provider embeds in the reset email. {{.Code}},
 * {{.UserID}}, {{.OrgID}} are provider-side placeholders Zitadel substitutes when
 * it sends the mail; they must stay RAW (not percent-encoded).
 *
 * ENUMERATION SAFETY: we look up the user and only call sendPasswordReset when
 * found, but BOTH branches emit the SAME audit event and yield the IDENTICAL
 * outcome. An attacker observing responses or logs cannot distinguish a known
 * account from an unknown one. The caller renders the generic check-your-email
 * response regardless of branch.
 */
export async function requestPasswordReset(
  provider: AuthProvider,
  { loginName, organization, origin, requestId }: RequestPasswordResetInput
): Promise<void> {
  const urlTemplate = verifyUrlTemplate({
    origin,
    path: '/password/new',
    requestId,
  });

  const user = await provider.findUser(loginName, organization);
  if (user) {
    await provider.sendPasswordReset(user.id, urlTemplate);
  } else {
    // constantTimeNoop: single-tick yield to avoid a trivial timing difference.
    // Full constant-time hardening (matching sendPasswordReset cost profile) is
    // a Phase 6 item (ENH-01).
    await constantTimeNoop();
  }

  // Same event regardless of branch — never branch audit on account existence.
  logAuthEvent('password.reset.requested', 'success', { actor: hashActor(loginName) });
}

// ── new (set a password from a reset code) ────────────────────────────────────

export type NewPasswordError = 'INVALID_INPUT' | 'INVALID_CREDENTIALS' | 'PASSWORD_COMPLEXITY';

export type SubmitNewPasswordResult =
  { ok: true; target: string } | { ok: false; error: NewPasswordError };

/**
 * Parse + dispatch a "set new password" submission.
 *
 * The requestId allowlist lives in `newPasswordSchema`, so a tampered
 * mid-ceremony requestId is rejected here at the boundary (→ INVALID_INPUT) and can
 * never forward into /authorize.
 *
 * On success returns the post-reset redirect target (the route performs redirect()).
 * Provider failures are mapped to friendly typed errors; non-mapped errors re-throw.
 */
export async function submitNewPassword(
  provider: AuthProvider,
  formEntries: Record<string, unknown>,
  // The org's fetched complexity policy (the route resolves the org + fetches it, then threads it
  // in) so the SERVER validation matches the policy-driven UI. Omitted → legacy min-8/no-classes.
  policy?: PasswordComplexity
): Promise<SubmitNewPasswordResult> {
  const parsed = newPasswordSchemaFor(policy).safeParse(formEntries);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const { code, userId, password, requestId } = parsed.data;

  try {
    await provider.setPasswordWithCode(userId, code, password);
    logAuthEvent('password.reset.completed', 'success', { userId });
    const target = requestId ? `/authorize?requestId=${requestId}` : '/login';
    return { ok: true, target };
  } catch (error) {
    logAuthEvent('password.reset.completed', 'failure', { userId });
    if (error instanceof ProviderError) {
      if (error.code === 'INVALID_CREDENTIALS') {
        // The reset code is invalid or expired — safe to surface since the code is the secret.
        return { ok: false, error: 'INVALID_CREDENTIALS' };
      }
      if (error.code === 'PASSWORD_COMPLEXITY') {
        return { ok: false, error: 'PASSWORD_COMPLEXITY' };
      }
    }
    throw error;
  }
}

// ── change (authenticated password change via active session) ─────────────────

export type ChangePasswordError =
  | 'INVALID_INPUT'
  | 'SESSION_EXPIRED'
  | 'PASSWORD_COMPLEXITY'
  | 'INVALID_CREDENTIALS'
  | 'PERMISSION_DENIED';

export type ChangePasswordResult =
  | { ok: true; target: string }
  | { ok: false; error: ChangePasswordError }
  // Step-up required: the route redirects to `reauthTarget` (/reauth with a returnTo back here).
  | { ok: false; error: 'SUDO_REQUIRED'; reauthTarget: string };

/** A resolved ceremony session — only the fields the change flow needs. */
export interface ActiveSession {
  id: string;
  token: string;
}

/** The /reauth target that returns to /password/change, keeping a mid-ceremony requestId. */
export function passwordChangeReauthTarget(requestId?: string | null): string {
  return paths.reauth({
    returnTo: paths.password.change(requestId ? { requestId } : undefined),
  });
}

/**
 * Step-up check for the password change (the same sudo window /id/passkeys uses). Returns
 * 'fresh' when a factor was verified within SUDO_TTL_MS, 'stale' when the session is live but
 * older than that, and 'dead' when the provider no longer knows the session.
 */
export async function passwordChangeSudo(
  provider: AuthProvider,
  session: ActiveSession,
  nowMs: number
): Promise<'fresh' | 'stale' | 'dead'> {
  try {
    const live = await provider.getSession(session.id, session.token);
    if (!live) return 'dead';
    return isSudoFresh(live.factors, nowMs) ? 'fresh' : 'stale';
  } catch (err) {
    if (isStaleSessionError(err)) return 'dead';
    throw err;
  }
}

/**
 * Parse + dispatch an authenticated password change.
 *
 * `resolveSession` looks up the session token by id from the SIGNED cookie (never
 * from client input); the route supplies it. A missing session → SESSION_EXPIRED.
 *
 * STEP-UP: a live session alone is not enough. The session cookie lives 24h, so one lifted from
 * an unattended browser could otherwise rotate the password. Zitadel's SetPassword (called with
 * the session token and no current password or code) documents no freshness check, so this is
 * the only freshness gate: a factor must have been verified within the sudo window, else
 * SUDO_REQUIRED and the route bounces through /reauth. This is THE security boundary; the
 * loader's check is UX only.
 *
 * On success returns the redirect target. Provider failures:
 *  - INITIAL-state users are normalized to PERMISSION_DENIED by the adapter; complexity
 *    and credential failures get their own friendly copy. None of these are enumeration-
 *    sensitive (the session already proves identity).
 *  - non-mapped errors re-throw.
 */
export async function changePassword(
  provider: AuthProvider,
  formEntries: Record<string, unknown>,
  resolveSession: (sessionId: string) => ActiveSession | undefined,
  // See submitNewPassword: the org complexity policy the route resolved + fetched, so the SERVER
  // validation matches the policy-driven UI. undefined → legacy min-8/no-classes.
  policy: PasswordComplexity | undefined,
  nowMs: number
): Promise<ChangePasswordResult> {
  const parsed = changePasswordSchemaFor(policy).safeParse(formEntries);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };
  const { sessionId, password, requestId } = parsed.data;

  const session = resolveSession(sessionId);
  if (!session) return { ok: false, error: 'SESSION_EXPIRED' };

  const sudo = await passwordChangeSudo(provider, session, nowMs);
  if (sudo === 'dead') return { ok: false, error: 'SESSION_EXPIRED' };
  if (sudo === 'stale') {
    logAuthEvent('password.change', 'failure', {
      sessionId: session.id,
      reason: 'sudo_required',
    });
    return {
      ok: false,
      error: 'SUDO_REQUIRED',
      reauthTarget: passwordChangeReauthTarget(requestId),
    };
  }

  try {
    await provider.changePasswordWithSession(session.id, session.token, password);
    logAuthEvent('password.change', 'success', { sessionId: session.id });
    return { ok: true, target: requestId ? `/authorize?requestId=${requestId}` : '/signed-in' };
  } catch (error) {
    logAuthEvent('password.change', 'failure', { sessionId: session.id });
    if (error instanceof ProviderError) {
      if (
        error.code === 'PASSWORD_COMPLEXITY' ||
        error.code === 'INVALID_CREDENTIALS' ||
        error.code === 'PERMISSION_DENIED'
      ) {
        return { ok: false, error: error.code };
      }
    }
    throw error;
  }
}

// Re-exported so callers/tests can reach the schemas through the domain barrel.
export { newPasswordSchema, resetRequestSchema, changePasswordSchema };
