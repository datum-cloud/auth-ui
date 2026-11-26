import type { AuthProvider } from '@/modules/auth/auth-provider';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { matchDisposableDomain } from '@/resources/signup/disposable-email';
import { registerEmailLinkSignup } from '@/resources/signup/signup.service';
import { env } from '@/server/infra/env.server';
import { logAuthEvent } from '@/server/observability';

export interface PasskeySignupInput {
  email: string;
  firstName: string;
  lastName: string;
  organization?: string;
  requestId?: string;
  /** Trusted app origin (PUBLIC_ORIGIN), never the request Host header. */
  origin: string;
}

/**
 * `null` means the attempt was refused by policy or configuration; the caller answers 400
 * INVALID_INPUT. The reason is deliberately not surfaced — org policy and deployment
 * configuration are not the submitter's business.
 *
 * `refused: 'DISPOSABLE_EMAIL'` is the one refusal that IS surfaced: the address is the
 * submitter's own choice, and the fix (a permanent address, or Google or GitHub) is theirs.
 */
export type PasskeySignupResult = { email: string } | { refused: 'DISPOSABLE_EMAIL' } | null;

/**
 * The one passkey-signup register path, shared by /signup and /signup/method.
 *
 * The first two gates are a server-side authorization check; two copies drift, and tightening one
 * while the other keeps registering is a silent hole. Re-read here rather than trusted from the
 * loader's view, because hiding a control is display-only.
 */
export async function registerPasskeySignup(
  provider: AuthProvider,
  input: PasskeySignupInput
): Promise<PasskeySignupResult> {
  const policy = await provider.getLoginSettings(await resolveOrg(provider, input.organization));
  if (policy.allowRegister === false || policy.passkeysType === 'not_allowed') return null;

  // Passkey signup IS the verification-mail flow: the link lands on /signup/complete?…&next=passkey
  // and the ceremony happens there, after the address is proven. Without delivery there is no way
  // to finish, so refuse rather than create an account nobody can verify.
  if (!env.AUTH_EMAIL_DELIVERY_ENABLED) return null;

  // Disposable inboxes, from the vendored list. Observe mode (the default) records the match and
  // carries on, so the effect can be measured before SIGNUP_BLOCK_DISPOSABLE_EMAIL refuses it.
  // The log carries the matched list entry only, never the address.
  const disposableDomain = matchDisposableDomain(input.email);
  if (disposableDomain) {
    const enforce = env.SIGNUP_BLOCK_DISPOSABLE_EMAIL;
    logAuthEvent('signup_disposable_email', 'failure', {
      mode: enforce ? 'enforce' : 'observe',
      domain: disposableDomain,
    });
    if (enforce) return { refused: 'DISPOSABLE_EMAIL' };
  }

  // Mints NO session and attaches no fraud metadata: both happen on the verification-link hop
  // (/signup/complete), the only place a session is created.
  const result = await registerEmailLinkSignup(provider, {
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    organization: input.organization,
    requestId: input.requestId,
    origin: input.origin,
  });
  return { email: result.email };
}
