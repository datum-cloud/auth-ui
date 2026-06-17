/**
 * Shared WebAuthn assertion-ceremony route handlers (loader + action).
 *
 * Both login.passkey.tsx and login.security-key.tsx perform the same ceremony;
 * they differ only in:
 *   - userVerificationRequirement ('required' vs 'discouraged')
 *   - audit event names ('mfa_passkey*' vs 'mfa_u2f*')
 *
 * createWebAuthnVerifyHandlers() returns a typed { loader, action } pair
 * parameterised by those values. Each route file re-exports them and keeps its
 * own component JSX (user-facing copy differs between passkey and security-key).
 *
 * Loader data type:
 *   React Router 7 can infer `typeof loader` when the function is declared
 *   directly in the route module, but the inference does not propagate through a
 *   factory return value. We therefore export a concrete WebAuthnVerifyLoaderData
 *   type and use  `useLoaderData() as WebAuthnVerifyLoaderData`  in the route
 *   components (with a comment explaining why we cannot use `typeof loader`).
 */
import { nextStepWithParams } from './next-step-params';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { readSessions, byLoginName, addSession, serializeSessions } from '@/session/cookie';
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { z } from 'zod';

// ── Shared credential Zod schema ────────────────────────────────────────────

// CODE-MIN-11: renamed from credentialSchema to webauthnAssertionSchema to remove the name
// collision with the minimal { credential } shape in app/flows/mfa-schemas.ts. These are
// legitimately different schemas; the name collision was confusing and drift-prone.
export const webauthnAssertionSchema = z.object({
  credential: z.string().min(1),
  loginName: z.string().min(1),
  requestId: z.string().optional(),
  organization: z.string().optional(),
});

// ── Loader data shape ────────────────────────────────────────────────────────

/**
 * Exported concrete type for the loader data.
 *
 * React Router 7 cannot infer `typeof loader` through a factory return —
 * the type variable on `data()` is not reified at the call site when the
 * function is returned from a higher-order function.  Route components must
 * therefore cast:
 *
 *   const d = useLoaderData() as WebAuthnVerifyLoaderData;
 *
 * Behaviour is identical to `useLoaderData<typeof loader>()` in a direct route.
 */
export interface WebAuthnVerifyLoaderData {
  csrfToken: string;
  loginName: string;
  requestId: string | undefined;
  organization: string | undefined;
  publicKeyCredentialRequestOptions: unknown;
}

// ── Action data shape ────────────────────────────────────────────────────────

/**
 * Exported concrete type for the action data.
 *
 * React Router 7 cannot infer `typeof action` through a factory return —
 * `useActionData<typeof action>()` resolves to `never` when `action` is a
 * re-exported value rather than a locally declared function.  Route components
 * must therefore cast:
 *
 *   const actionData = useActionData() as WebAuthnVerifyActionData | undefined;
 */
export type WebAuthnVerifyActionData =
  | { error: 'INVALID_INPUT' }
  | { error: 'SESSION_EXPIRED' }
  | { error: 'INVALID_CREDENTIALS' };

// ── Factory config ───────────────────────────────────────────────────────────

export interface WebAuthnVerifyConfig {
  /** Passed to the FIDO2 challenge; 'required' for passkeys, 'discouraged' for U2F security keys. */
  userVerificationRequirement: 'required' | 'discouraged';
  /** Audit event name for the assertion attempt (success / failure). */
  auditEvent: 'mfa_passkey' | 'mfa_u2f';
  /** Audit event name for the challenge request failure. */
  challengeAuditEvent: 'mfa_passkey_challenge' | 'mfa_u2f_challenge';
}

// ── Factory ──────────────────────────────────────────────────────────────────

// Return type is intentionally inferred — DataWithResponseInit is not exported
// from react-router's public API so we let TypeScript infer the full union.
// The exported WebAuthnVerifyLoaderData and WebAuthnVerifyActionData types are
// what route components use; they don't depend on this signature.
export function createWebAuthnVerifyHandlers(cfg: WebAuthnVerifyConfig) {
  async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const loginName = url.searchParams.get('loginName') ?? '';
    const requestId = url.searchParams.get('requestId') ?? undefined;
    const organization = url.searchParams.get('organization') ?? undefined;

    // Guard: require an active session for this loginName.
    const sessions = await readSessions(request);
    const entry = byLoginName(sessions, loginName, organization);
    if (!entry) return redirect('/login');

    // Request a WebAuthn assertion challenge parameterised by userVerificationRequirement.
    const provider = providerForRequest(request);
    const domain = url.hostname;
    let publicKeyCredentialRequestOptions: unknown = null;
    try {
      const session = await provider.updateSession(entry.id, entry.token, {
        challenges: {
          webAuthN: {
            domain,
            userVerificationRequirement: cfg.userVerificationRequirement,
          },
        },
      });
      publicKeyCredentialRequestOptions =
        session.challenges?.webAuthN?.publicKeyCredentialRequestOptions ?? null;
    } catch {
      logAuthEvent(cfg.challengeAuditEvent, 'failure', { loginName });
      // Challenge failure is not fatal — the browser will show an error when the button is clicked.
    }

    const [csrfToken, setCookie] = await getCsrfToken(request);
    const headers: Record<string, string> = {};
    if (setCookie !== null) headers['set-cookie'] = setCookie;

    return data<WebAuthnVerifyLoaderData>(
      { csrfToken, loginName, requestId, organization, publicKeyCredentialRequestOptions },
      { headers }
    );
  }

  async function action({ request }: ActionFunctionArgs) {
    const provider = providerForRequest(request);
    const form = await request.formData();
    await assertCsrf(request, form);

    const parsed = webauthnAssertionSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

    const { credential, loginName, requestId, organization } = parsed.data;

    const sessions = await readSessions(request);
    const entry = byLoginName(sessions, loginName, organization);
    if (!entry) {
      logAuthEvent(cfg.auditEvent, 'failure', { loginName, reason: 'session_expired' });
      return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });
    }

    let credentialData: unknown;
    try {
      credentialData = JSON.parse(credential);
    } catch {
      return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
    }

    let session;
    try {
      session = await provider.updateSession(entry.id, entry.token, {
        webAuthN: { credentialAssertionData: credentialData },
      });
    } catch (err) {
      logAuthEvent(cfg.auditEvent, 'failure', { loginName });
      if (err instanceof ProviderError && err.code === 'INVALID_CREDENTIALS') {
        return data({ error: 'INVALID_CREDENTIALS' as const }, { status: 401 });
      }
      throw err;
    }

    logAuthEvent(cfg.auditEvent, 'success', {
      userId: session.user?.id,
      sessionId: session.id,
    });

    // Write back the (potentially rotated) session token.
    const next = addSession(sessions, {
      ...entry,
      token: session.token,
      changeTs: session.changedAt,
      expirationTs: session.expiresAt,
    });

    const userId = session.user?.id ?? '';
    const [methods, settings] = await Promise.all([
      provider.listAuthMethods(userId),
      provider.getLoginSettings(organization),
    ]);

    // MAJ-15: passkey.userVerified drives the passwordless-shortcut in nextStep → /signed-in.
    const target = nextStepWithParams({
      factors: session.factors,
      settings,
      enrolledMethods: methods,
      loginName: session.user?.loginName ?? loginName,
      userVerified: session.factors.passkey?.userVerified ?? false,
      mfaInitSkippedAt: session.user?.mfaInitSkippedAt,
      requestId,
      organization,
    });

    return redirect(target, {
      headers: { 'set-cookie': await serializeSessions(next) },
    });
  }

  return { loader, action };
}
