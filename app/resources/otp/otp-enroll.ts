/**
 * Shared OTP enrollment route handlers (loader + action).
 *
 * Both setup.email.tsx and setup.sms.tsx perform the same enrollment ceremony;
 * they differ only in:
 *   - enroll: the provider method to call (addOtpEmail / addOtpSms)
 *   - factor: the audit label ('otp_email' / 'otp_sms')
 *   - verifyPath: the post-enrollment verify redirect ('/login/verify/email' | '/login/verify/sms')
 *
 * createOtpEnrollHandlers() returns a typed { loader, action } pair
 * parameterised by those values. Each route file re-exports them and keeps its
 * own component JSX (user-facing copy differs between email and SMS).
 *
 * Loader data type:
 *   React Router 7 cannot infer `typeof loader` through a factory return —
 *   the type variable on `data()` is not reified at the call site when the
 *   function is returned from a higher-order function. Route components must
 *   therefore cast:
 *
 *     const d = useLoaderData() as OtpEnrollLoaderData;
 *
 *   Behaviour is identical to `useLoaderData<typeof loader>()` in a direct route.
 */
import { type AuthProvider } from '@/modules/auth/auth-provider';
import { readSessions, byLoginName } from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import { setupSkipSchema } from '@/resources/mfa/mfa.schema';
import {
  nextStepWithParams,
  threadParams,
  loginBounceTarget,
} from '@/resources/shared/next-step-params';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { resolveSessionUser } from '@/resources/shared/resolve-session-user';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { z } from 'zod';

// ── Action input schema ──────────────────────────────────────────────────────

const otpEnrollActionSchema = z.object({
  loginName: z.string().min(1),
  requestId: z.string().optional(),
  organization: z.string().optional(),
  checkAfter: setupSkipSchema.shape.checkAfter,
});

// ── Loader data shape ────────────────────────────────────────────────────────

/**
 * Exported concrete type for the loader data.
 *
 * React Router 7 cannot infer `typeof loader` through a factory return —
 * the type variable on `data()` is not reified at the call site when the
 * function is returned from a higher-order function. Route components must
 * therefore cast:
 *
 *   const d = useLoaderData() as OtpEnrollLoaderData;
 *
 * Behaviour is identical to `useLoaderData<typeof loader>()` in a direct route.
 */
export interface OtpEnrollLoaderData {
  csrfToken: string;
  loginName: string;
  requestId: string | undefined;
  organization: string | undefined;
  force: 'true' | 'false' | undefined;
  checkAfter: 'true' | 'false' | undefined;
}

// ── Action data shape ────────────────────────────────────────────────────────

/**
 * Exported concrete type for the action data.
 *
 * React Router 7 cannot infer `typeof action` through a factory return —
 * `useActionData<typeof action>()` resolves to `never` when `action` is a
 * re-exported value rather than a locally declared function. Route components
 * must therefore cast:
 *
 *   const actionData = useActionData() as OtpEnrollActionData | undefined;
 */
export type OtpEnrollActionData =
  { error: 'INVALID_INPUT' } | { error: 'SESSION_EXPIRED' } | { error: 'ENROLL_FAILED' };

// ── Factory config ───────────────────────────────────────────────────────────

export interface OtpEnrollConfig {
  /** Provider method to call to register the OTP factor for the user. */
  enroll: (provider: AuthProvider, userId: string) => Promise<void>;
  /** Audit label for log events. */
  factor: 'otp_email' | 'otp_sms';
  /** Redirect target when checkAfter=true, e.g. '/login/verify/email'. */
  verifyPath: string;
}

// ── Factory ──────────────────────────────────────────────────────────────────

// Return type is intentionally inferred — DataWithResponseInit is not exported
// from react-router's public API so we let TypeScript infer the full union.
// The exported OtpEnrollLoaderData and OtpEnrollActionData types are what route
// components use; they don't depend on this signature.
export function createOtpEnrollHandlers(cfg: OtpEnrollConfig) {
  async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const loginName = url.searchParams.get('loginName') ?? '';
    const requestId = url.searchParams.get('requestId') ?? undefined;
    const organization = url.searchParams.get('organization') ?? undefined;
    // Never throw a 500 on tampered query params. Both fields are optional —
    // an invalid value degrades to undefined (no skip-force, no auto-checkAfter).
    const skip = setupSkipSchema.safeParse(Object.fromEntries(url.searchParams));
    const { force, checkAfter } = skip.success ? skip.data : {};

    // Guard: require an active session for this loginName.
    const sessions = await readSessions(request);
    const entry = byLoginName(sessions, loginName, organization);
    // Bounce to /login WITH the ceremony context (requestId/organization, parsed above) so a
    // dead session mid-OIDC/SAML/device ceremony can still resume after re-login.
    if (!entry) return redirect(loginBounceTarget(requestId, organization));

    const [csrfToken, setCookie] = await getCsrfToken(request);
    const headers: Record<string, string> = {};
    if (setCookie !== null) headers['set-cookie'] = setCookie;

    return data<OtpEnrollLoaderData>(
      { csrfToken, loginName, requestId, organization, force, checkAfter },
      { headers }
    );
  }

  async function action({ request }: ActionFunctionArgs) {
    const provider = providerForRequest(request);
    const form = await request.formData();
    await assertCsrf(request, form);

    const parsed = otpEnrollActionSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

    const { loginName, requestId, organization, checkAfter } = parsed.data;

    // Guard: a LIVE session is required, and the enrollment binds to the user THAT session
    // authenticated as — not to whoever currently holds the name. The old findUser-by-name
    // resolution bounced legacy IdP cookies (issue #1485) and, after a loginName reassignment,
    // would have enrolled the OTP factor against a different account (see resolveSessionUser).
    const sessions = await readSessions(request);
    const resolved = await resolveSessionUser(provider, sessions, loginName, organization);
    if (!resolved) {
      logAuthEvent('mfa_enroll', 'failure', {
        loginName,
        factor: cfg.factor,
        reason: 'session_expired',
      });
      return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });
    }

    const { entry, userId } = resolved;

    try {
      await cfg.enroll(provider, userId);
    } catch (err) {
      logAuthEvent('mfa_enroll', 'failure', { userId, factor: cfg.factor });
      if (err instanceof ProviderError) {
        return data({ error: 'ENROLL_FAILED' as const }, { status: 500 });
      }
      throw err;
    }

    logAuthEvent('mfa_enroll', 'success', { userId, factor: cfg.factor });

    // checkAfter=true: immediately route into the matching verify screen.
    if (checkAfter === 'true') {
      return redirect(`${cfg.verifyPath}?${threadParams(loginName, requestId, organization)}`);
    }

    // Normal post-enrollment routing.
    const session = await provider.getSession(entry.id, entry.token);
    if (!session) {
      logAuthEvent('mfa_enroll', 'failure', {
        loginName,
        factor: cfg.factor,
        reason: 'session_expired',
      });
      return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });
    }

    // Org-first: an explicit org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
    const [methods, settings] = await Promise.all([
      provider.listAuthMethods(userId),
      provider.getLoginSettings(await resolveOrg(provider, organization)),
    ]);

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

    return redirect(target);
  }

  return { loader, action };
}
