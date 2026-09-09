// app/resources/recovery/recovery.service.ts
//
// The whole /recover request decision, in one place, because every branch of it has to be
// indistinguishable from every other branch to the caller.
//
// G7 ENUMERATION SAFETY IS THE DESIGN CONSTRAINT. `requestRecovery` returns the SAME shape on
// every path — an outcome the route never discloses, and a ticket of a fixed length. Whether the
// address is unknown, rate-limited, refused by org policy, undeliverable, or a live account that
// just got a mail, the route sends back the same status, the same body and a Set-Cookie of the
// same length. Only the side effect varies. That is why:
//
//   - the limiter runs FIRST and is SHARED with signup's resend (one per-address budget: two
//     limiters would let the two forms be combined to double the real mail rate);
//   - every refusal goes through `suppress`, which always issues a filler ticket;
//   - `sendRecoveryMail` never throws and its result is NOT branched on — a user whose mail
//     failed must be indistinguishable from one whose mail arrived;
//   - the outer catch swallows provider faults into the same suppressed shape.
//
// SECURITY: the code is a bearer credential. It is read out of the envelope, handed to the mail
// client, and never logged, never returned, and never put in the ticket (which carries `codeId`).
// The audit lines carry a HASHED actor and a bounded reason vocabulary.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { decodePasskeyRegistrationCode } from '@/modules/auth/passkey-registration-code';
import { ProviderError } from '@/modules/auth/types';
import { fillerTicket, sealRequestTicket } from '@/resources/recovery/recovery-ticket.server';
import { mailReturnTo } from '@/resources/shared/mail-return-to';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { allowResend } from '@/resources/signup/signup-resend-limit';
import { resendVerification } from '@/resources/signup/verification-resend';
import { env } from '@/server/infra/env.server';
import { sendRecoveryMail } from '@/server/infra/recovery-mail.server';
import { hashActor, logAuthEvent } from '@/server/observability';

/** What actually happened. Audited, never disclosed to the browser. */
export type RecoveryOutcome = 'sent' | 'resumed_signup' | 'suppressed';

/** Bounded vocabulary — an unbounded reason string would leak account state into the audit log
 *  and into metric cardinality. */
export type SuppressReason =
  'rate_limited' | 'unknown_address' | 'org_policy' | 'delivery_disabled' | 'provider_error';

export interface RequestRecoveryInput {
  email: string;
  organization?: string;
  requestId?: string;
  origin: string;
}

export interface RequestRecoveryResult {
  outcome: RecoveryOutcome;
  /** Sealed or filler — the SAME LENGTH either way. The route sets it on every exit. */
  ticket: string;
}

export async function requestRecovery(
  provider: AuthProvider,
  input: RequestRecoveryInput
): Promise<RequestRecoveryResult> {
  const { email, organization, requestId, origin } = input;
  const actor = hashActor(email);

  const suppress = (reason: SuppressReason): RequestRecoveryResult => {
    logAuthEvent('recovery_request', 'failure', { actor, outcome: 'suppressed', reason });
    return { outcome: 'suppressed', ticket: fillerTicket() };
  };

  try {
    // Limiter FIRST and SHARED with signup's resend: the two forms draw on one per-address
    // budget. First because a denied request must do no provider work at all — a rate-limited
    // path that still ran findUser would leak account existence through timing.
    if (!(await allowResend(email))) return suppress('rate_limited');

    const user = await provider.findUser(email, organization);
    if (!user) return suppress('unknown_address');

    const methods = await provider.listAuthMethods(user.id);
    if (methods.length === 0) {
      // Class (d): zero methods is only possible BEFORE verification, because verification always
      // enrolls otpEmail in the same call. So this address is an unfinished signup, and the only
      // thing we may send an unproven address is its own verification link. Resume signup with
      // the SAME helper signup's resendIfSquatted uses, landing on /signup/complete?next=passkey.
      //
      // Zitadel saying "already verified" is the rare verified-but-methodless edge (verification
      // succeeded, addOtpEmail failed) — fall through to a real recovery link below.
      if (
        (await resendVerification(provider, user, { origin, requestId, organization })) === 'sent'
      ) {
        logAuthEvent('recovery_request', 'success', { actor, outcome: 'resumed_signup' });
        return { outcome: 'resumed_signup', ticket: fillerTicket() };
      }
    }

    // Same refusal registerPasskeySignup applies: an org that forbids passkeys cannot be handed
    // one through the recovery door either. Re-read from the provider, not trusted from a view.
    const policy = await provider.getLoginSettings(await resolveOrg(provider, organization));
    if (policy.passkeysType === 'not_allowed') return suppress('org_policy');

    if (!env.RECOVERY_MAIL_URL) return suppress('delivery_disabled');

    const envelope = decodePasskeyRegistrationCode(
      (await provider.passkeyRegisterLink(user.id)).code
    );
    if (!envelope) return suppress('provider_error');

    // Never throws, and the result is deliberately NOT branched on: the ticket is issued either
    // way, because a delivery failure must not be visible to the requester. The client audits the
    // failure itself.
    await sendRecoveryMail({
      userId: user.id,
      codeId: envelope.id,
      code: envelope.code,
      requestedBy: 'self',
      returnTo: mailReturnTo(origin, '/recover/complete', { requestId, organization }),
    });

    logAuthEvent('recovery_request', 'success', { actor, outcome: 'sent', userId: user.id });
    return {
      outcome: 'sent',
      ticket: sealRequestTicket({ userId: user.id, codeId: envelope.id, email }),
    };
  } catch (error) {
    // A provider fault must not change the response — it degrades to the same suppressed shape
    // every other refusal produces. Only the bounded ProviderError code is logged; never the
    // error's message, which could echo request context back.
    logAuthEvent('recovery_request', 'failure', {
      actor,
      outcome: 'suppressed',
      reason: 'provider_error',
      code: error instanceof ProviderError ? error.code : 'UNKNOWN',
    });
    return { outcome: 'suppressed', ticket: fillerTicket() };
  }
}
