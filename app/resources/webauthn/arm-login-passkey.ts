// app/resources/webauthn/arm-login-passkey.ts
//
// The /login loader's passkey arming decision, extracted whole.
//
// Two arms, tried in order rather than as alternatives. The user-bound arm needs a
// resolvable identity and a session the provider will accept; the discovery arm needs
// neither (mintIdentityChallenge is SELF-issued — no provider round-trip, nothing
// persisted), so it can catch every decline the first arm produces.
//
// They were previously mutually exclusive (`if (hint) … else if (!hint) …`), which meant a
// declined hint arm dead-ended on the email field even though discovery would have worked.
// Combined with a zero-live-sessions guard on discovery, that made the Passkey button
// unusable for the entire add-another-account population.
import { mintIdentityChallenge } from './identity-challenge';
import { armUserBoundChallenge } from './webauthn.service';
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { listSessions, type SessionEntry } from '@/modules/auth/session/cookie';

export interface LoginPasskeyArming {
  conditionalPasskey: { loginName: string; publicKeyCredentialRequestOptions: unknown } | null;
  identityDiscovery: { publicKeyCredentialRequestOptions: unknown } | null;
  /** Set-Cookie values the caller must append (ceremony session + fingerprint). */
  setCookies: string[];
  /** The hint named a user that can never fire — caller should clear the cookie. */
  clearHint: boolean;
}

export interface ArmLoginPasskeyInput {
  /** Signed passkey-hint cookie value, or null. */
  hint: string | null;
  /** `?add=1` — the user explicitly wants a DIFFERENT identity. */
  isAddAccount: boolean;
  sessions: SessionEntry[];
  /** Request hostname — the FIDO2 relying-party id. */
  hostname: string;
  /** AUTH_PASSKEY_DISCOVERY_ENABLED — operational kill switch, default ON. */
  discoveryEnabled: boolean;
}

export async function armLoginPasskey(
  provider: AuthProvider,
  request: Request,
  { hint, isAddAccount, sessions, hostname, discoveryEnabled }: ArmLoginPasskeyInput
): Promise<LoginPasskeyArming> {
  let conditionalPasskey: LoginPasskeyArming['conditionalPasskey'] = null;
  const setCookies: string[] = [];
  let clearHint = false;

  // ── Arm 1: user-bound, from the hint ────────────────────────────────────────
  // Skipped under ?add=1: the hint names the account the user ALREADY holds, so arming
  // it would sign them back into it — the opposite of "add another account".
  if (hint && !isAddAccount) {
    // LIVE session, not merely a cookie entry: armUserBoundChallenge's caller contract
    // requires this, because its same-loginName supersede is safe only against dead
    // entries. listSessions is the codebase's expiry-aware filter.
    const hasLiveSession = listSessions(sessions, Date.now()).some(
      (s) => s.loginName.toLowerCase() === hint.toLowerCase()
    );
    if (!hasLiveSession) {
      const user = await provider.findUser(hint);
      if (!user) {
        // Deleted/renamed user — the hint can never fire; drop it.
        clearHint = true;
      } else if ((await provider.listAuthMethods(user.id)).includes('passkey')) {
        try {
          const armed = await armUserBoundChallenge(provider, request, sessions, user, hostname);
          if (armed) {
            setCookies.push(...armed.setCookies);
            conditionalPasskey = {
              loginName: armed.loginName,
              publicKeyCredentialRequestOptions: armed.publicKeyCredentialRequestOptions,
            };
          }
        } catch {
          // Session creation failed (deactivated user, provider hiccup) — clear the hint
          // and let the discovery arm below catch it.
          clearHint = true;
        }
      }
    }
  }

  // ── Arm 2: discovery, catching every decline above ──────────────────────────
  // Free by design: self-minted options, no provider call, nothing persisted. Zitadel
  // enters only at /login/passkey-discover, after a credential has actually been tapped.
  // Deliberately NOT gated on live sessions: a signed-in visitor adding a second account
  // is exactly the population this serves. /login/passkey-discover keeps its own
  // per-user guard, so the loader decides what to OFFER and the action enforces what is
  // ALLOWED.
  const identityDiscovery =
    !conditionalPasskey && discoveryEnabled
      ? { publicKeyCredentialRequestOptions: mintIdentityChallenge(hostname) }
      : null;

  return { conditionalPasskey, identityDiscovery, setCookies, clearHint };
}
