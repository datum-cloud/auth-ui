/**
 * Shared WebAuthn ENROLLMENT route handlers (loader + action).
 *
 * setup/passkey.tsx and setup/security-key.tsx ran byte-identical loader/action
 * bodies; they differed only in:
 *   - which attestation challenge to request (requestPasskeyAttestation /
 *     requestU2FAttestation) and which enrollment to verify (verifyPasskeyEnrollment /
 *     verifyU2FEnrollment),
 *   - the credential-id field name posted by the hidden form ('passkeyId' / 'u2fId'),
 *   - whether the challenge can degrade with a `challengeFailed` warning (passkey
 *     surfaces it; the U2F button shows the inline error on click instead).
 *
 * createWebAuthnEnrollHandlers() returns a typed { loader, action } pair parameterised
 * by those values. Each route re-exports them (`export const loader = h.loader`) and
 * keeps its own component JSX (user-facing copy differs between the two ceremonies).
 *
 * The shared `unwrapPublicKey` (the inner-publicKey extract the WebAuthnButton needs)
 * is folded here — it was duplicated verbatim in both routes.
 *
 * Loader data type:
 *   Both routes adopt the factory via a locally-exported `const loader = h.loader`, so
 *   RR7 infers `data<WebAuthnEnrollLoaderData>` through the generic — no `as` cast is
 *   needed (mirrors the fix for createOtpEnrollHandlers).
 */
import {
  requestPasskeyAttestation,
  requestU2FAttestation,
  verifyPasskeyEnrollment,
  verifyU2FEnrollment,
  type AttestationLoaderInput,
  type PasskeyAttestationResult,
  type U2FAttestationResult,
  type EnrollResult,
} from './webauthn.service';
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { readSessions, type SessionEntry } from '@/modules/auth/session/cookie';
import { credentialSchema, setupSkipSchema } from '@/resources/mfa/mfa.schema';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { z } from 'zod';

// ── Shared inner-publicKey unwrap ─────────────────────────────────────────────

/**
 * Extract the inner `publicKey` object the WebAuthnButton consumes. The provider
 * returns the RAW publicKeyCredentialCreationOptions; some shapes nest the spec
 * `publicKey` one level in, others already are it. Identical to the per-route helper
 * the two setup routes duplicated (mirrors login.passkey.tsx). Non-serializable
 * concerns stay out of the service, so this lives at the route-factory boundary.
 */
export function unwrapPublicKey(publicKeyCredentialCreationOptions: unknown): unknown {
  if (
    publicKeyCredentialCreationOptions !== null &&
    typeof publicKeyCredentialCreationOptions === 'object' &&
    'publicKey' in (publicKeyCredentialCreationOptions as object)
  ) {
    return (publicKeyCredentialCreationOptions as { publicKey: unknown }).publicKey;
  }
  return publicKeyCredentialCreationOptions;
}

export interface WebAuthnEnrollLoaderData {
  csrfToken: string;
  loginName: string;
  requestId: string | undefined;
  organization: string | undefined;
  force: 'true' | 'false' | undefined;
  checkAfter: 'true' | 'false' | undefined;
  credentialId: string | null;
  publicKey: unknown;
  challengeFailed: boolean;
}

export type WebAuthnEnrollActionData =
  | { error: 'INVALID_INPUT' }
  | { error: 'SESSION_EXPIRED' }
  | { error: 'INVALID_CREDENTIALS' };

export interface WebAuthnEnrollConfig {
  /** The hidden form field name the route posts for the credential id ('passkeyId' | 'u2fId'). */
  credentialField: 'passkeyId' | 'u2fId';
  /** Request the attestation challenge (passkey vs U2F differ in provider sequence). */
  requestAttestation: (
    provider: AuthProvider,
    sessions: SessionEntry[],
    input: AttestationLoaderInput
  ) => Promise<PasskeyAttestationResult | U2FAttestationResult>;
  /** Verify the enrollment (passkey vs U2F differ in the provider verify method). */
  verifyEnrollment: (
    provider: AuthProvider,
    sessions: SessionEntry[],
    input: {
      credential: string;
      credentialId: string;
      loginName: string;
      requestId?: string;
      organization?: string;
      checkAfter?: 'true' | 'false';
    }
  ) => Promise<EnrollResult>;
}

// Static action schema — both credential-id fields are optional here; the factory then
// asserts the config's required field is present (a computed-key z.object() would erase
// zod's static inference, widening every field to `string | undefined`). Parses the posted
// form byte-identically to the old per-route schemas; the id is normalised to `credentialId`.
const enrollActionSchema = z.object({
  credential: credentialSchema.shape.credential,
  passkeyId: z.string().min(1).optional(),
  u2fId: z.string().min(1).optional(),
  loginName: z.string().min(1),
  requestId: z.string().optional(),
  organization: z.string().optional(),
  force: z.enum(['true', 'false']).optional(),
  checkAfter: z.enum(['true', 'false']).optional(),
});

export const PASSKEY_ENROLL_CONFIG: WebAuthnEnrollConfig = {
  credentialField: 'passkeyId',
  requestAttestation: requestPasskeyAttestation,
  verifyEnrollment: (provider, sessions, input) =>
    verifyPasskeyEnrollment(provider, sessions, {
      credential: input.credential,
      passkeyId: input.credentialId,
      loginName: input.loginName,
      requestId: input.requestId,
      organization: input.organization,
      checkAfter: input.checkAfter,
    }),
};

export const U2F_ENROLL_CONFIG: WebAuthnEnrollConfig = {
  credentialField: 'u2fId',
  requestAttestation: requestU2FAttestation,
  verifyEnrollment: (provider, sessions, input) =>
    verifyU2FEnrollment(provider, sessions, {
      credential: input.credential,
      u2fId: input.credentialId,
      loginName: input.loginName,
      requestId: input.requestId,
      organization: input.organization,
      checkAfter: input.checkAfter,
    }),
};

export function createWebAuthnEnrollHandlers(cfg: WebAuthnEnrollConfig) {
  async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const loginName = url.searchParams.get('loginName') ?? '';
    const requestId = url.searchParams.get('requestId') ?? undefined;
    const organization = url.searchParams.get('organization') ?? undefined;
    const { force, checkAfter } = setupSkipSchema.parse(Object.fromEntries(url.searchParams));

    const provider = providerForRequest(request);
    const sessions = await readSessions(request);

    const result = await cfg.requestAttestation(provider, sessions, {
      loginName,
      organization,
      domain: url.hostname,
    });
    if (result.kind === 'redirect') return redirect(result.target);

    // The U2F challenge result has no challengeFailed field — default it false.
    const credentialId = 'passkeyId' in result ? result.passkeyId : result.u2fId;
    const challengeFailed = 'challengeFailed' in result ? result.challengeFailed : false;
    const publicKey = unwrapPublicKey(result.publicKeyCredentialCreationOptions);

    const [csrfToken, setCookie] = await getCsrfToken(request);
    const headers: Record<string, string> = {};
    if (setCookie !== null) headers['set-cookie'] = setCookie;

    return data<WebAuthnEnrollLoaderData>(
      {
        csrfToken,
        loginName,
        requestId,
        organization,
        force,
        checkAfter,
        credentialId,
        publicKey,
        challengeFailed,
      },
      { headers }
    );
  }

  async function action({ request }: ActionFunctionArgs) {
    const provider = providerForRequest(request);
    const form = await request.formData();
    await assertCsrf(request, form);

    const parsed = enrollActionSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

    const { credential, loginName, requestId, organization, checkAfter } = parsed.data;
    // The required credential id is keyed per-config (passkeyId | u2fId); absence is INVALID_INPUT.
    const credentialId = parsed.data[cfg.credentialField];
    if (!credentialId) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

    const sessions = await readSessions(request);
    const result = await cfg.verifyEnrollment(provider, sessions, {
      credential,
      credentialId,
      loginName,
      requestId,
      organization,
      checkAfter,
    });

    if (!result.ok) {
      const status = result.error === 'INVALID_CREDENTIALS' ? 401 : 400;
      return data({ error: result.error }, { status });
    }

    return redirect(result.target);
  }

  return { loader, action };
}
