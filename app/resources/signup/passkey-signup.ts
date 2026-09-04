import type { AuthProvider } from '@/modules/auth/auth-provider';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { registerEmailLinkSignup } from '@/resources/signup/signup.service';
import { env } from '@/server/infra/env.server';

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
 */
export type PasskeySignupResult = { email: string } | null;

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
