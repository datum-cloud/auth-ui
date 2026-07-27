// app/resources/shared/usable-methods.ts
//
// Filters ENROLLED auth methods down to ones actually USABLE right now, given org login
// policy + instance config — the same gates decideAfterIdentifier (login-decision.ts) and
// /login/method's own chooser already apply per-method. A method can be enrolled but not
// currently offered (e.g. an org disables password auth, or an operator turns off email
// delivery, after a user already enrolled that method) — callers deciding "does this user
// still have a working backup method" need the gated view, not the raw enrolled list.
import type { AuthMethod, LoginSettings } from '@/modules/auth/types';

export function usableSignInMethods(
  enrolled: AuthMethod[],
  settings: LoginSettings,
  emailDeliveryEnabled: boolean
): AuthMethod[] {
  return enrolled.filter((m) => {
    if (m === 'passkey') return settings.passkeysType !== 'not_allowed';
    if (m === 'idp') return settings.allowExternalIdp;
    if (m === 'password') return settings.allowPassword;
    if (m === 'otp_email') return emailDeliveryEnabled;
    // totp / u2f / otp_sms are second-factor methods, not gated by these primary
    // sign-in settings — pass through unchanged.
    return true;
  });
}
