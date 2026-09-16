// app/resources/signup/verification-resend.ts
//
// The ONE signup-verification resend, shared by signup's `resendIfSquatted` and recovery's
// class-(d) branch. Both doors have to send the same mail to the same destination: an account
// with zero auth methods is an unverified signup, and whichever door the user knocks on, the
// right answer is to finish the signup they started — not to mail a recovery link to an address
// nobody has proven they own.
//
// DOES NOT RATE-LIMIT. `allowResend` stays with the callers on purpose: signup and recovery draw
// on ONE per-address budget, and a limiter in here plus a limiter in each caller would either
// double-count or (worse) let the two forms be combined to double the real mail rate.
//
// Throws ProviderError for anything except ALREADY_DONE, which is returned as
// 'already_verified' — the rare verified-but-methodless account (verification succeeded,
// addOtpEmail failed). It is a routing signal, not a failure: recovery falls through to a real
// recovery link, and signup keeps its generic answer.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { User } from '@/modules/auth/types';
import { ProviderError } from '@/modules/auth/types';
import { mailReturnTo } from '@/resources/shared/mail-return-to';
import { signupCompleteUrlTemplate } from '@/resources/verify/verify-url-template';
import { env } from '@/server/infra/env.server';
import { sendVerificationMail } from '@/server/infra/verification-mail.server';
import { hashActor, logAuthEvent } from '@/server/observability';

export type ResendOutcome = 'sent' | 'already_verified';

/**
 * Sends the signup verification mail to `user`: returnCode through our own pipeline, falling back
 * to Zitadel's url-template path when VERIFICATION_MAIL_URL is unset. Audits
 * `signup_verification_resent` on success.
 *
 * `link.organization` MUST be the caller's already-RESOLVED org, not a raw route param —
 * `mailReturnTo` emits it verbatim (no Zitadel placeholder substitution happens here), so an
 * unresolved value silently drops the organization from the emailed link.
 */
export async function resendVerification(
  provider: AuthProvider,
  user: Pick<User, 'id' | 'loginName'>,
  link: { origin: string; requestId?: string; organization?: string }
): Promise<ResendOutcome> {
  try {
    // CRITICAL fallback (final-findings.md CRITICAL 1): unset VERIFICATION_MAIL_URL means the
    // milo pipeline isn't configured in this environment, so fall back to Zitadel's own
    // resend-with-url-template path instead of requesting a returnCode we cannot deliver.
    if (!env.VERIFICATION_MAIL_URL) {
      await provider.resendEmailCodeWithUrl(user.id, signupCompleteUrlTemplate(link));
    } else {
      // returnCode delivery: the code comes back in-band instead of Zitadel emailing it, and
      // sendVerificationMail (never throws — see verification-mail.server.ts) delivers it through
      // OUR pipeline, landing on the SAME /signup/complete?next=passkey destination
      // signupCompleteUrlTemplate builds for Zitadel's own sendCode path.
      const code = await provider.resendEmailCode(user.id);
      await sendVerificationMail({
        userId: user.id,
        code,
        returnTo: mailReturnTo(link.origin, '/signup/complete', {
          requestId: link.requestId,
          organization: link.organization,
          next: 'passkey',
        }),
      });
    }
    // Audited under its OWN event, not the shared signup.requested. This dispatches mail to an
    // address the submitter has not proven they own — a security-relevant outbound action that
    // has to be attributable on its own. Safe for enumeration: the audit log is server-side only
    // and never reaches the caller. Parity is a property of the RESPONSE, not the log.
    logAuthEvent('signup_verification_resent', 'success', { actor: hashActor(user.loginName) });
    return 'sent';
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'ALREADY_DONE') return 'already_verified';
    throw error;
  }
}
