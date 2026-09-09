// app/resources/recovery/recovery-ceremony.ts
//
// The two-step passkey ceremony both recovery paths converge on — the mailed link
// (/recover/complete) and the typed code (/recover). It is SESSION-LESS by design: neither step
// reads the sessions cookie and neither applies the sudo gate, because the mailed code IS the
// authorisation. That is the whole difference between this and /setup/passkey, which is why it
// lives here rather than inside the existing enrollment factory.
//
// start:  consume the single-use registration code -> WebAuthn creation options + a sealed
//         ceremony ticket naming { userId, passkeyId }.
// finish: open that ticket, verify the credential the browser produced, name the passkey.
//
// THE TICKET DECIDES, NOT THE FORM. Between the two steps the only thing that carries identity is
// the sealed cookie. The form's `passkeyId` is compared against the ticket's and refused on a
// mismatch — it is never used as the value — and the form has no userId field at all. Without
// that rule, a session-less verify endpoint would let anyone who reached step two point it at
// another account.
//
// SECURITY: the code is a bearer credential, so it appears only as an argument to the provider
// call. Every audit line here carries the userId, the path and the stage — never the code, never
// the credential.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { encodePasskeyRegistrationCode } from '@/modules/auth/passkey-registration-code';
import { ProviderError } from '@/modules/auth/types';
import { credentialSchema } from '@/resources/mfa/mfa.schema';
import {
  openCeremonyTicket,
  recoveryCeremonyCookie,
  sealCeremonyTicket,
} from '@/resources/recovery/recovery-ticket.server';
import { unwrapPublicKey } from '@/resources/webauthn/webauthn-enroll';
import { logAuthEvent } from '@/server/observability';
import { z } from 'zod';

/** Which door the user came through. Audited so the two can be told apart in incident review. */
export type RecoveryPath = 'link' | 'code';

export type StartResult =
  | { ok: true; passkeyId: string; publicKey: unknown; setCookie: string }
  | { ok: false; error: 'INVALID_CODE' };

export type FinishResult =
  | { ok: true; loginName: string }
  | { ok: false; error: 'EXPIRED' | 'INVALID_CREDENTIALS' | 'INVALID_INPUT' };

// No userId: it comes from the sealed ticket. passkeyId is present only to be CHECKED.
const finishSchema = z.object({
  credential: credentialSchema.shape.credential,
  passkeyId: z.string().min(1),
  // Set-once label (no rename RPC); 1-200 runes Zitadel-side.
  passkeyName: z.string().trim().max(200).optional(),
});

/**
 * Consumes the registration code and opens the WebAuthn ceremony. The code is single-use in
 * Zitadel, so a second call with the same code — a refreshed page, a prefetched link — fails
 * here with INVALID_CODE, which the routes render as "request a new link".
 */
export async function startRecoveryCeremony(
  provider: AuthProvider,
  input: { userId: string; codeId: string; code: string; domain: string; path: RecoveryPath }
): Promise<StartResult> {
  const { userId, codeId, code, domain, path } = input;
  try {
    const options = await provider.registerPasskey(
      userId,
      encodePasskeyRegistrationCode({ id: codeId, code }),
      domain
    );
    const setCookie = await recoveryCeremonyCookie.serialize(
      sealCeremonyTicket({ userId, passkeyId: options.passkeyId })
    );
    logAuthEvent('recovery_complete', 'success', { userId, path, stage: 'start' });
    return {
      ok: true,
      passkeyId: options.passkeyId,
      publicKey: unwrapPublicKey(options.publicKeyCredentialCreationOptions),
      setCookie,
    };
  } catch (error) {
    // A bad, consumed or expired code all arrive here as a ProviderError and all get the same
    // answer — the caller must not be able to tell them apart. Anything else is a real fault and
    // is rethrown rather than being disguised as a bad code.
    if (!(error instanceof ProviderError)) throw error;
    logAuthEvent('recovery_complete', 'failure', {
      userId,
      path,
      stage: 'start',
      code: error.code,
    });
    return { ok: false, error: 'INVALID_CODE' };
  }
}

/**
 * Verifies the credential the browser produced and names the new passkey. Identity comes from the
 * ceremony ticket ONLY; the form's passkeyId must match it.
 *
 * Returns the loginName so the route can send the user to /login with the identifier prefilled —
 * recovery deliberately does not create a session (§5: the new passkey signs in through the
 * ordinary ceremony).
 */
export async function finishRecoveryCeremony(
  provider: AuthProvider,
  request: Request,
  form: FormData,
  path: RecoveryPath
): Promise<FinishResult> {
  const ticket = openCeremonyTicket(
    (await recoveryCeremonyCookie.parse(request.headers.get('cookie'))) as string | null
  );
  if (!ticket) {
    logAuthEvent('recovery_complete', 'failure', { path, stage: 'finish', reason: 'EXPIRED' });
    return { ok: false, error: 'EXPIRED' };
  }

  const parsed = finishSchema.safeParse(Object.fromEntries(form));
  // The mismatch check is the load-bearing half: the form may not name another passkey.
  if (!parsed.success || parsed.data.passkeyId !== ticket.passkeyId) {
    logAuthEvent('recovery_complete', 'failure', {
      userId: ticket.userId,
      path,
      stage: 'finish',
      reason: 'INVALID_INPUT',
    });
    return { ok: false, error: 'INVALID_INPUT' };
  }

  // The credential is a JSON string the browser built; a malformed one is bad input, not a
  // failed verification, and must not reach the provider (webauthn.service.ts guards the same way).
  let credentialData: unknown;
  try {
    credentialData = JSON.parse(parsed.data.credential);
  } catch {
    logAuthEvent('recovery_complete', 'failure', {
      userId: ticket.userId,
      path,
      stage: 'finish',
      reason: 'INVALID_INPUT',
    });
    return { ok: false, error: 'INVALID_INPUT' };
  }

  try {
    await provider.verifyPasskey(
      ticket.userId,
      ticket.passkeyId,
      credentialData,
      parsed.data.passkeyName
    );
  } catch (error) {
    logAuthEvent('recovery_complete', 'failure', {
      userId: ticket.userId,
      path,
      stage: 'finish',
      code: error instanceof ProviderError ? error.code : 'UNKNOWN',
    });
    return { ok: false, error: 'INVALID_CREDENTIALS' };
  }

  const user = await provider.getUser(ticket.userId);
  logAuthEvent('recovery_complete', 'success', { userId: ticket.userId, path, stage: 'finish' });
  return { ok: true, loginName: user?.loginName ?? '' };
}
