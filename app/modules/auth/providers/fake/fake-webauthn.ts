// WebAuthn verification for the fake auth provider (AUTH_PROVIDER=fake, e2e only). Challenges are
// issued and checked for real, so a browser virtual authenticator can run full ceremonies.
// `@simplewebauthn/server` is loaded lazily so the production zitadel provider never pulls it in.
import { ProviderError } from '@/modules/auth/types';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

/** The pre-baked credential id the CYPRESS_CREDENTIAL stub posts; accepted without verification. */
export const PREBAKED_CREDENTIAL_ID = 'fake-credential-id';

export interface StoredCredential {
  /** base64url credential id */
  id: string;
  /** base64url COSE public key */
  publicKey: string;
  counter: number;
  userId: string;
}

type UserVerification = 'required' | 'discouraged';
type PendingChallenge = { challenge: string; uv: UserVerification };

/** Loaded lazily: a devDependency, only needed under AUTH_PROVIDER=fake. */
async function loadWebAuthnLib() {
  try {
    return await import('@simplewebauthn/server');
  } catch (cause) {
    throw new Error('AUTH_PROVIDER=fake needs devDependencies installed (@simplewebauthn/server)', {
      cause,
    });
  }
}

const b64url = {
  fromText: (s: string) => Buffer.from(s, 'utf8').toString('base64url'),
  toBytes: (s: string) => new Uint8Array(Buffer.from(s, 'base64url')),
  fromBytes: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
};

/** Origin the browser reported, if it belongs to `domain` (any port for localhost). The library
 *  only compares origins exactly, so the port-agnostic check happens here and the vetted origin is
 *  then handed to it as the expected one. */
function vettedOrigin(posted: { response: { clientDataJSON: string } }, domain: string): string {
  let origin: string;
  try {
    const raw = Buffer.from(String(posted.response.clientDataJSON), 'base64url').toString();
    origin = String((JSON.parse(raw) as { origin?: unknown }).origin);
    const u = new URL(origin);
    const ok =
      domain === 'localhost'
        ? u.hostname === 'localhost' && (u.protocol === 'http:' || u.protocol === 'https:')
        : origin === `https://${domain}`;
    if (ok) return origin;
  } catch {
    // fall through to the rejection below
  }
  throw new ProviderError('INVALID_CREDENTIALS', 'origin mismatch');
}

/** Fill the fields @simplewebauthn expects that the browser code does not post. */
function normalize<T extends RegistrationResponseJSON | AuthenticationResponseJSON>(
  credential: unknown
): T {
  const c = (credential ?? {}) as Record<string, unknown>;
  const response = { ...((c.response ?? {}) as Record<string, unknown>) };
  if (response.userHandle === null) delete response.userHandle;
  return {
    ...c,
    id: String(c.id ?? ''),
    rawId: c.rawId ?? c.id,
    type: c.type ?? 'public-key',
    clientExtensionResults: c.clientExtensionResults ?? {},
    response,
  } as unknown as T;
}

export class FakeWebAuthn {
  private readonly credentials = new Map<string, StoredCredential>();
  private readonly challenges = new Map<string, PendingChallenge>();

  constructor(seed: StoredCredential[] = []) {
    for (const c of seed) this.credentials.set(c.id, { ...c });
  }

  private forUser(userId: string): StoredCredential[] {
    return [...this.credentials.values()].filter((c) => c.userId === userId);
  }

  async creationOptions(
    user: { id: string; loginName: string; displayName?: string },
    domain: string,
    key: string
  ): Promise<{ publicKey: PublicKeyCredentialCreationOptionsJSON }> {
    const { generateRegistrationOptions } = await loadWebAuthnLib();
    const options = await generateRegistrationOptions({
      rpName: 'Datum',
      rpID: domain,
      userName: user.loginName,
      userDisplayName: user.displayName ?? user.loginName,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: this.forUser(user.id).map((c) => ({ id: c.id })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    this.challenges.set(key, { challenge: options.challenge, uv: 'required' });
    return { publicKey: options };
  }

  async verifyRegistration(
    userId: string,
    key: string,
    credential: unknown,
    domain: string
  ): Promise<void> {
    const posted = normalize<RegistrationResponseJSON>(credential);
    if (posted.id === PREBAKED_CREDENTIAL_ID) return;
    const pending = this.challenges.get(key);
    if (!pending) throw new ProviderError('INVALID_CREDENTIALS', 'no pending registration');
    this.challenges.delete(key);
    const { verifyRegistrationResponse } = await loadWebAuthnLib();
    const origin = vettedOrigin(posted, domain);
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: posted,
        expectedChallenge: pending.challenge,
        expectedOrigin: origin,
        expectedRPID: domain,
        requireUserVerification: pending.uv === 'required',
      });
    } catch (err) {
      throw new ProviderError('INVALID_CREDENTIALS', `registration failed: ${String(err)}`);
    }
    if (!result.verified) throw new ProviderError('INVALID_CREDENTIALS', 'registration rejected');
    const { id, publicKey, counter } = result.registrationInfo.credential;
    const owner = this.credentials.get(id)?.userId;
    if (owner !== undefined && owner !== userId) {
      throw new ProviderError('INVALID_CREDENTIALS', 'credential id belongs to another user');
    }
    this.credentials.set(id, { id, publicKey: b64url.fromBytes(publicKey), counter, userId });
  }

  async requestOptions(
    userId: string,
    domain: string,
    uv: UserVerification,
    sessionId: string
  ): Promise<{ publicKey: PublicKeyCredentialRequestOptionsJSON }> {
    const { generateAuthenticationOptions } = await loadWebAuthnLib();
    const options = await generateAuthenticationOptions({
      rpID: domain,
      userVerification: uv,
      allowCredentials: this.forUser(userId).map((c) => ({ id: c.id })),
    });
    this.challenges.set(sessionId, { challenge: options.challenge, uv });
    return { publicKey: options };
  }

  async verifyAssertion(
    userId: string,
    sessionId: string,
    credential: unknown,
    domain: string
  ): Promise<{ userVerified: boolean }> {
    const posted = normalize<AuthenticationResponseJSON>(credential);
    if (posted.id === PREBAKED_CREDENTIAL_ID) return { userVerified: true };
    const stored = this.credentials.get(posted.id);
    if (!stored || stored.userId !== userId) {
      throw new ProviderError('INVALID_CREDENTIALS', 'unknown credential');
    }
    const pending = this.challenges.get(sessionId);
    if (!pending) throw new ProviderError('INVALID_CREDENTIALS', 'no pending challenge');
    this.challenges.delete(sessionId);
    const origin = vettedOrigin(posted, domain);
    const { verifyAuthenticationResponse } = await loadWebAuthnLib();
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: posted,
        expectedChallenge: pending.challenge,
        expectedOrigin: origin,
        expectedRPID: domain,
        requireUserVerification: pending.uv === 'required',
        credential: {
          id: stored.id,
          publicKey: b64url.toBytes(stored.publicKey),
          counter: stored.counter,
        },
      });
    } catch (err) {
      throw new ProviderError('INVALID_CREDENTIALS', `assertion failed: ${String(err)}`);
    }
    if (!result.verified) throw new ProviderError('INVALID_CREDENTIALS', 'assertion rejected');
    this.credentials.set(stored.id, { ...stored, counter: result.authenticationInfo.newCounter });
    return { userVerified: result.authenticationInfo.userVerified };
  }
}
