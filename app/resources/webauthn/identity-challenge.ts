// app/resources/webauthn/identity-challenge.ts
//
// Self-minted discovery challenge for the usernameless identity-resolution path
// (spec: 2026-07-31-usernameless-passkey-discovery-design.md). NOT a Zitadel
// challenge and NEVER verified: the assertion it produces is an identity CLAIM
// (userHandle read only) at the trust level of the passkey-hint cookie. Because
// nothing checks the signature, nothing is persisted server-side either — the
// challenge exists only so navigator.credentials.get has valid bytes to sign.
// Wrapped as { publicKey: {...} } to match the Zitadel option shape every
// ceremony hook already unwraps (unwrapPublicKey).

/** 2 minutes — generous for an autofill tap; browsers may ignore it under conditional mediation. */
const IDENTITY_CHALLENGE_TIMEOUT_MS = 120_000;

export function mintIdentityChallenge(rpId: string): { publicKey: Record<string, unknown> } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return {
    publicKey: {
      challenge: Buffer.from(bytes).toString('base64url'),
      rpId,
      // Empty on purpose — the browser offers EVERY resident key for this RP.
      allowCredentials: [],
      // The single biometric belongs to the authenticating ceremony (UV 'required'
      // on the real Zitadel challenge); the identity tap is selection only.
      userVerification: 'discouraged',
      timeout: IDENTITY_CHALLENGE_TIMEOUT_MS,
    },
  };
}
