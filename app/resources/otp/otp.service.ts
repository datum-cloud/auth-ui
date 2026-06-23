// app/resources/otp/otp.service.ts
//
// Pass 2 extraction: the loader/action BUSINESS logic for the OTP domain.
//
// Two ceremonies live here:
//   • VERIFY  — login/verify/{email,sms,authenticator}.tsx: the loader dispatches
//     the delivery challenge (email url_template / sms boolean) as a side effect, and
//     the action verifies the submitted code then resolves the post-verify redirect
//     TARGET. The three channels share one action shape, differing only in the code
//     schema, the SessionChecks verify field, and the audit channel/event.
//   • ENROLL  — setup/authenticator.tsx (TOTP register+verify) plus the shared
//     setup/{email,sms}.tsx factory (createOtpEnrollHandlers), folded in / re-exported
//     through the barrel below.
//
// Every function takes a provider + plain inputs and returns a typed result; no Request
// parsing, no CSRF, no cookie I/O lives here. The route resolves the active session from
// the SIGNED cookie and hands the resolved entry (or undefined) in. React rendering and
// the route's redirect()/data() wiring stay in the route module.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { ProviderError } from '@/modules/auth/types';
import { otpCodeSchema, otpDeliveryCodeSchema } from '@/resources/mfa/mfa.schema';
import { otpEmailUrlTemplate } from '@/resources/otp/otp-email-url-template';
import { nextStepWithParams } from '@/resources/shared/next-step-params';
import { logAuthEvent } from '@/server/observability';
import { z } from 'zod';

// ── shared session shapes ─────────────────────────────────────────────────────

/**
 * The active ceremony session resolved from the SIGNED sessions cookie — only the
 * fields the OTP flows need. The route resolves this (readSessions → byLoginName) and
 * passes it in; `undefined` means no usable session for this loginName.
 */
export interface OtpSessionEntry {
  id: string;
  token: string;
  loginName: string;
  creationTs?: string;
  expirationTs?: string;
  changeTs?: string;
}

/** The three delivery/verify channels the OTP verify ceremony supports. */
export type OtpVerifyChannel = 'email' | 'sms' | 'authenticator';

// ── verify loader: challenge dispatch (side effect) ────────────────────────────

export interface EmailChallengeInput {
  /**
   * TRUSTED app origin (scheme + host), e.g. from trustedAppOrigin(request).
   * SECURITY: this MUST come from trusted config (PUBLIC_ORIGIN), never the
   * client-controllable request Host header — otherwise an attacker could inject a
   * verification link pointing at their own host.
   */
  origin: string;
  loginName: string;
  requestId?: string;
  organization?: string;
}

/**
 * Trigger the EMAIL OTP code send via the challenges seam.
 *
 * The otpEmail challenge carries an url_template so Zitadel mails OUR link
 * (/id/login/verify/email) instead of its default /ui/v2/login/otp/email page. The
 * result rides back on Session.challenges (unused — the send is the side effect we want).
 *
 * Failure is NON-FATAL: the challenge send failing is logged and swallowed so the UI
 * still renders; the user can attempt a code from a prior send. NEVER call this on the
 * link path (code already in hand) — a re-send would rotate/invalidate the held code.
 */
export async function dispatchEmailChallenge(
  provider: AuthProvider,
  entry: OtpSessionEntry,
  { origin, loginName, requestId, organization }: EmailChallengeInput
): Promise<void> {
  try {
    const urlTemplate = otpEmailUrlTemplate({ origin, loginName, requestId, organization });
    await provider.updateSession(entry.id, entry.token, {
      // Discriminated email-OTP challenge — override the emailed link with OUR /verify route.
      challenges: { otpEmail: { kind: 'send-template', urlTemplate } },
    });
  } catch {
    logAuthEvent('mfa_otp_challenge', 'failure', { loginName, channel: 'email' });
    // Continue — the challenge send failure is not fatal for the UI.
    // The user can still attempt to enter a code they received via a prior send.
  }
}

/**
 * Trigger the SMS OTP code send via the challenges seam.
 *
 * checks.challenges.otpSms=true requests the challenge; the result rides back on
 * Session.challenges (unused — the send is the side effect we want). Failure is
 * NON-FATAL: logged and swallowed so the UI still renders.
 */
export async function dispatchSmsChallenge(
  provider: AuthProvider,
  entry: OtpSessionEntry,
  loginName: string
): Promise<void> {
  try {
    await provider.updateSession(entry.id, entry.token, { challenges: { otpSms: true } });
  } catch {
    logAuthEvent('mfa_otp_challenge', 'failure', { loginName, channel: 'sms' });
    // Continue — the challenge send failure is not fatal for the UI.
    // The user can still attempt to enter a code they received via a prior send.
  }
}

// ── verify action: code verification + post-verify routing ─────────────────────

export type SubmitOtpError = 'INVALID_INPUT' | 'SESSION_EXPIRED' | 'INVALID_CREDENTIALS';

/**
 * Result of an OTP verification. On success the route writes back the (rotated) session
 * token from `session` and redirects to `target`; on failure it surfaces `error`.
 */
export type SubmitOtpResult =
  | {
      ok: true;
      target: string;
      /** The (potentially token-rotated) session to persist back into the cookie. */
      session: {
        token: string;
        changedAt: string;
        expiresAt: string;
      };
    }
  | { ok: false; error: SubmitOtpError };

/**
 * Per-channel binding for the verify action. The three login/verify routes differ ONLY in:
 *   - schema:      the code schema (delivery 6–8 digits for email/sms, strict 6 for TOTP)
 *   - check:       the SessionChecks verify field name (otpEmail / otpSms / totp)
 *   - successEvent / failureEvent: the audit event names
 *   - channel:     the audit channel label ('email' | 'sms'); omitted for authenticator
 */
interface VerifyChannelConfig {
  schema: typeof otpCodeSchema | typeof otpDeliveryCodeSchema;
  check: 'otpEmail' | 'otpSms' | 'totp';
  successEvent: 'mfa_otp' | 'mfa_totp';
  failureEvent: 'mfa_otp' | 'mfa_totp';
  channel?: 'email' | 'sms';
}

const VERIFY_CHANNELS: Record<OtpVerifyChannel, VerifyChannelConfig> = {
  email: {
    schema: otpDeliveryCodeSchema,
    check: 'otpEmail',
    successEvent: 'mfa_otp',
    failureEvent: 'mfa_otp',
    channel: 'email',
  },
  sms: {
    schema: otpDeliveryCodeSchema,
    check: 'otpSms',
    successEvent: 'mfa_otp',
    failureEvent: 'mfa_otp',
    channel: 'sms',
  },
  authenticator: {
    schema: otpCodeSchema,
    check: 'totp',
    successEvent: 'mfa_totp',
    failureEvent: 'mfa_totp',
  },
};

/**
 * Parse + verify a submitted OTP code for the given channel, then resolve the
 * post-verify redirect TARGET.
 *
 *  - Parses the form via the channel's code schema (malformed → INVALID_INPUT 400).
 *  - Guards an active session for the loginName (the route resolves `entry`; undefined
 *    → SESSION_EXPIRED 400).
 *  - Calls updateSession with the channel verify field; provider INVALID_CREDENTIALS
 *    (bad/expired code) → typed INVALID_CREDENTIALS 401. Other provider errors re-throw.
 *  - On success logs the audit event and computes the next-step target from the
 *    returned session factors + the user's enrolled methods + org login settings.
 *
 * The (rotated) session token/timestamps ride back on the result so the route can write
 * the session cookie; this function does NOT touch cookies.
 */
export async function submitOtpCode(
  provider: AuthProvider,
  channel: OtpVerifyChannel,
  formEntries: Record<string, unknown>,
  entry: OtpSessionEntry | undefined
): Promise<SubmitOtpResult> {
  const cfg = VERIFY_CHANNELS[channel];

  const parsed = z
    .object({
      code: cfg.schema.shape.code,
      loginName: z.string().min(1),
      requestId: z.string().optional(),
      organization: z.string().optional(),
    })
    .safeParse(formEntries);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const { code, loginName, requestId, organization } = parsed.data;

  if (!entry) return { ok: false, error: 'SESSION_EXPIRED' };

  let session;
  try {
    session = await provider.updateSession(entry.id, entry.token, { [cfg.check]: code });
  } catch (err) {
    logAuthEvent(
      cfg.failureEvent,
      'failure',
      cfg.channel ? { loginName, channel: cfg.channel } : { loginName }
    );
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }
    throw err;
  }

  logAuthEvent(
    cfg.successEvent,
    'success',
    cfg.channel
      ? { userId: session.user?.id, sessionId: session.id, channel: cfg.channel }
      : { userId: session.user?.id, sessionId: session.id }
  );

  const userId = session.user?.id ?? '';
  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(organization),
  ]);

  const target = nextStepWithParams({
    factors: session.factors,
    settings,
    enrolledMethods: methods,
    loginName: session.user?.loginName ?? loginName,
    userVerified: session.factors.passkey?.userVerified ?? false,
    mfaInitSkippedAt: session.user?.mfaInitSkippedAt,
    requestId,
    organization,
  });

  return {
    ok: true,
    target,
    session: {
      token: session.token,
      changedAt: session.changedAt,
      expiresAt: session.expiresAt,
    },
  };
}

// ── TOTP enroll (setup/authenticator.tsx action + loader) ──────────────────────

export type EnrollTotpError = 'SESSION_EXPIRED' | 'INVALID_INPUT' | 'INVALID_CREDENTIALS';

export type EnrollTotpResult = { ok: true; target: string } | { ok: false; error: EnrollTotpError };

const enrollTotpActionSchema = z.object({
  code: otpCodeSchema.shape.code,
  loginName: z.string().min(1),
  requestId: z.string().optional(),
  organization: z.string().optional(),
  force: z.enum(['true', 'false']).optional(),
  checkAfter: z.enum(['true', 'false']).optional(),
});

/**
 * Verify a freshly-scanned TOTP secret and resolve the post-enroll redirect TARGET
 * (setup/authenticator.tsx action).
 *
 *  - Parses the form (malformed → INVALID_INPUT 400).
 *  - Guards an active session for loginName (`entry` undefined → SESSION_EXPIRED 400).
 *  - Resolves the userId via findUser (no user → SESSION_EXPIRED 400).
 *  - verifyTotp; provider INVALID_CREDENTIALS → typed INVALID_CREDENTIALS 401; other
 *    provider errors re-throw.
 *  - checkAfter=true → route straight into /login/verify/authenticator (params threaded).
 *  - otherwise derive the next step from the current session factors + enrolled methods
 *    + login settings; a missing session at this point → SESSION_EXPIRED 400.
 *
 * Returns only the redirect target / typed error; no cookie or render concerns.
 */
export async function enrollTotp(
  provider: AuthProvider,
  formEntries: Record<string, unknown>,
  entry: OtpSessionEntry | undefined
): Promise<EnrollTotpResult> {
  const parsed = enrollTotpActionSchema.safeParse(formEntries);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const { code, loginName, requestId, organization, checkAfter } = parsed.data;

  // Resolve userId — SessionEntry carries no userId field (mirror login.mfa.tsx).
  if (!entry) return { ok: false, error: 'SESSION_EXPIRED' };

  const user = await provider.findUser(loginName, organization);
  if (!user) return { ok: false, error: 'SESSION_EXPIRED' };

  const userId = user.id;

  try {
    await provider.verifyTotp(userId, code);
  } catch (err) {
    logAuthEvent('mfa_enroll', 'failure', { userId, factor: 'totp' });
    if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }
    throw err;
  }

  logAuthEvent('mfa_enroll', 'success', { userId, factor: 'totp' });

  // checkAfter=true: immediately route into the matching verify screen so the
  // user can confirm the newly enrolled factor works.
  if (checkAfter === 'true') {
    const params = new URLSearchParams({ loginName });
    if (requestId) params.set('requestId', requestId);
    if (organization) params.set('organization', organization);
    return { ok: true, target: `/login/verify/authenticator?${params.toString()}` };
  }

  // Normal post-enrollment routing: derive next step from current session state.
  const session = await provider.getSession(entry.id, entry.token);
  if (!session) return { ok: false, error: 'SESSION_EXPIRED' };

  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(organization),
  ]);

  const target = nextStepWithParams({
    factors: session.factors,
    settings,
    enrolledMethods: methods,
    loginName: session.user?.loginName ?? loginName,
    userVerified: session.factors.passkey?.userVerified ?? false,
    mfaInitSkippedAt: session.user?.mfaInitSkippedAt,
    requestId,
    organization,
  });

  return { ok: true, target };
}

// ── re-exports: enroll factory + url-template seed folded into the service ──────

export {
  createOtpEnrollHandlers,
  type OtpEnrollConfig,
  type OtpEnrollLoaderData,
  type OtpEnrollActionData,
} from '@/resources/otp/otp-enroll';
export {
  otpEmailUrlTemplate,
  type OtpEmailUrlTemplateInput,
} from '@/resources/otp/otp-email-url-template';
