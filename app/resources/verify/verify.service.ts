// app/resources/verify/verify.service.ts
//
// Pass 2 extraction: the loader/action BUSINESS logic for the email-verify domain
// (session-ownership gate on the email-code dispatch, send/resend dispatch with
// ALREADY_DONE swallow, code verification + post-verify redirect-target resolution,
// and ProviderError → typed-error mapping). React rendering and the route's
// redirect()/data() wiring stay in the route module.
//
// Every function takes a provider + plain inputs and returns a typed result; no
// Request parsing, no CSRF, no cookie I/O lives here. The route resolves the active
// session from the SIGNED cookie and hands the resolved session (or undefined) in.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { ProviderError } from '@/modules/auth/types';
import { verifyUrlTemplate } from '@/resources/verify/verify-url-template';
import { verifyCodeSchema } from '@/resources/verify/verify.schema';
import { logAuthEvent } from '@/server/observability';

// ── send (loader ?send=true email-code dispatch gate) ─────────────────────────

/**
 * The active ceremony session resolved from the SIGNED sessions cookie — only the
 * fields the send-gate needs. The route resolves this (readSessions → mostRecent)
 * and passes it in; `undefined` means no usable session.
 */
export interface ActiveSession {
  id: string;
  token: string;
}

export interface DispatchEmailCodeInput {
  /** The userId from the `?userId=` query param (the account we'd send a code to). */
  userId: string;
  /**
   * TRUSTED app origin (scheme + host), e.g. from trustedAppOrigin(request).
   * SECURITY: this MUST come from trusted config (PUBLIC_ORIGIN), never the
   * client-controllable request Host header — otherwise an attacker could inject a
   * verification link pointing at their own host.
   */
  origin: string;
  /** Carried through so the post-verify step can resume an OIDC/SAML ceremony. */
  requestId?: string;
  /** When true, the code is an invite code → resendEmailCode rather than sendEmailCode. */
  invite: boolean;
  /**
   * The active ceremony session resolved from the cookie, or undefined. The send is
   * GATED on this session owning `userId`; without it, nothing is dispatched.
   */
  session?: ActiveSession;
}

/**
 * CODE-MAJ-08: enumeration-/flood-safe email-code dispatch.
 *
 * An unauthenticated GET with ?send=true&userId=<anyone> was previously a code-flood /
 * enumeration vector — any attacker could trigger email sends to arbitrary accounts.
 * Fix: the caller resolves the active session from the SIGNED cookie; this gate calls
 * getSession to obtain the provider-verified user.id and only dispatches when it matches
 * `userId`. Mismatch, no session, or a getSession failure → silently skip (fail closed;
 * the manual-submit form still works).
 *
 * ALREADY_DONE from the provider means the user is already verified — swallowed
 * gracefully (the route still shows the form). Other provider errors re-throw.
 */
export async function dispatchEmailCode(
  provider: AuthProvider,
  { userId, origin, requestId, invite, session }: DispatchEmailCodeInput
): Promise<void> {
  if (!userId || !session) return;

  // Resolve the session cookie and verify ownership server-side via the provider.
  let ownsUser = false;
  try {
    const activeSession = await provider.getSession(session.id, session.token);
    ownsUser = !!activeSession && activeSession.user?.id === userId;
  } catch {
    // getSession failure → treat as no session (fail closed, do not send)
  }

  if (!ownsUser) return;

  try {
    // Raw {{.Code}}/{{.UserID}}/{{.OrgID}} placeholders — Zitadel does NOT decode
    // URL-encoded braces (verified live), so this MUST NOT go through URLSearchParams.
    const urlTemplate = verifyUrlTemplate({ origin, requestId, invite });

    if (invite) {
      // Invite codes use resendEmailCode per the provider interface
      await provider.resendEmailCode(userId, urlTemplate);
    } else {
      await provider.sendEmailCode(userId, urlTemplate);
    }
  } catch (error) {
    // ALREADY_DONE means the user is already verified — swallow gracefully.
    if (error instanceof ProviderError && error.code === 'ALREADY_DONE') {
      // fall through — the route shows the form; the user can proceed or be redirected
      return;
    }
    throw error;
  }
}

// ── resend (action intent=resend) ─────────────────────────────────────────────

export type ResendNotice = 'CODE_SENT' | 'ALREADY_VERIFIED';

export type ResendEmailError = 'INVALID_INPUT';

export type ResendEmailResult =
  | { ok: true; notice: ResendNotice }
  | { ok: false; error: ResendEmailError };

export interface ResendEmailCodeInput {
  userId: string;
  origin: string;
  requestId?: string;
  invite: boolean;
}

/**
 * Resend the verification email code. Returns a typed result the route surfaces:
 *  - { ok: true, notice: 'CODE_SENT' } on success
 *  - { ok: true, notice: 'ALREADY_VERIFIED' } when the provider reports ALREADY_DONE
 *  - { ok: false, error: 'INVALID_INPUT' } when userId is empty/missing
 * Other provider errors re-throw.
 *
 * INPUT GATE: the original action ran verifyCodeSchema.safeParse over the whole form
 * BEFORE branching on intent, so the resend path was also gated on userId.min(1)
 * (and invite ∈ {'true','false'}). The `invite` flag here is already a boolean, so the
 * remaining schema-equivalent guard is the userId non-empty check; a malformed/forged
 * resend (empty userId) returns INVALID_INPUT and never reaches the provider.
 */
export async function resendEmailCode(
  provider: AuthProvider,
  { userId, origin, requestId, invite }: ResendEmailCodeInput
): Promise<ResendEmailResult> {
  if (!userId) return { ok: false, error: 'INVALID_INPUT' };

  const urlTemplate = verifyUrlTemplate({ origin, requestId, invite });
  try {
    await provider.resendEmailCode(userId, urlTemplate);
    return { ok: true, notice: 'CODE_SENT' };
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'ALREADY_DONE') {
      return { ok: true, notice: 'ALREADY_VERIFIED' };
    }
    throw error;
  }
}

// ── verify (action default intent) ────────────────────────────────────────────

export type SubmitEmailError = 'INVALID_INPUT' | 'INVALID_CREDENTIALS';

export type SubmitEmailResult =
  | { ok: true; target: string }
  | { ok: false; error: SubmitEmailError };

/**
 * Parse + dispatch an email/invite code verification.
 *
 * Parses the form via verifyCodeSchema (malformed → INVALID_INPUT). On success,
 * verifies the code (verifyInvite for invite flows, verifyEmail otherwise), logs the
 * audit event, and resolves the post-verify redirect TARGET:
 *  - active session + requestId → resume the OIDC/SAML ceremony at /authorize
 *  - active session, no requestId → /signed-in
 *  - no active session → /verify/success (carrying loginName/requestId/organization)
 *
 * `hasActiveSession` is resolved by the route from the SIGNED cookie. Provider
 * INVALID_CREDENTIALS (bad/expired code) maps to a friendly typed error; other
 * provider errors re-throw.
 */
export async function submitEmailCode(
  provider: AuthProvider,
  formEntries: Record<string, unknown>,
  hasActiveSession: boolean
): Promise<SubmitEmailResult> {
  const parsed = verifyCodeSchema.safeParse(formEntries);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const { userId, code, invite, loginName, organization, requestId } = parsed.data;
  const isInvite = invite === 'true';

  try {
    if (isInvite) {
      await provider.verifyInvite(userId, code);
    } else {
      await provider.verifyEmail(userId, code);
    }
    logAuthEvent(isInvite ? 'invite.verified' : 'email.verified', 'success', { userId });

    if (hasActiveSession && requestId) {
      return { ok: true, target: `/authorize?requestId=${requestId}` };
    }
    if (hasActiveSession) {
      return { ok: true, target: '/signed-in' };
    }

    // No active session — send to success page
    const successParams = new URLSearchParams();
    if (loginName) successParams.set('loginName', loginName);
    if (requestId) successParams.set('requestId', requestId);
    if (organization) successParams.set('organization', organization);
    return { ok: true, target: `/verify/success?${successParams}` };
  } catch (error) {
    logAuthEvent(isInvite ? 'invite.verified' : 'email.verified', 'failure', { userId });
    if (error instanceof ProviderError && error.code === 'INVALID_CREDENTIALS') {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }
    throw error;
  }
}

// Re-exported so callers/tests can reach the schema + url helper through the barrel.
export { verifyCodeSchema };
export { verifyUrlTemplate } from '@/resources/verify/verify-url-template';
export { emailVerificationGate } from '@/resources/verify/email-verification';
export type { EmailVerificationInput, GateResult } from '@/resources/verify/email-verification';
export type { VerifyUrlTemplateInput } from '@/resources/verify/verify-url-template';
