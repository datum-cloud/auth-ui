/**
 * Shared OTP *verify* route handlers (loader + action) for the three login verify
 * ceremonies — login/verify/{email,sms,authenticator}. Mirrors createOtpEnrollHandlers.
 *
 * The three routes are ~85% identical; they differ only in:
 *   - channel: which OTP channel submitOtpCode validates ('email'|'sms'|'authenticator')
 *   - challenge dispatch: email/sms send a code (email suppresses on the ?code link path);
 *     authenticator sends nothing (the user reads the code from their app)
 *   - next handling: only email supports the next=passkey post-verify redirect
 *   - last-used-login: only email records a 'last used' hint (sms/authenticator are
 *     non-primary 2nd factors and the login screen never surfaces an 'sms' hint — made
 *     an EXPLICIT per-channel knob rather than accidental drift)
 *   - verifyPath: the screen's own path, used to redirect back on a resend
 *
 * createOtpVerifyHandlers() returns a typed { loader, action } pair parameterised by an
 * OtpVerifyConfig. Each route file re-exports them and keeps its own per-screen JSX.
 *
 * Loader/action data types: React Router 7 cannot infer `typeof loader`/`typeof action`
 * through a factory return, so route components cast:
 *   const d = useLoaderData() as OtpVerifyLoaderData;
 *   const a = useActionData() as OtpVerifyActionData | undefined;
 * (Identical limitation + documented cast as createOtpEnrollHandlers.)
 */
import { type AuthProvider } from '@/modules/auth/auth-provider';
import {
  readSessions,
  byLoginName,
  addSession,
  serializeSessions,
} from '@/modules/auth/session/cookie';
import { serializeLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { serializePasskeyHint } from '@/modules/auth/session/passkey-hint';
import {
  dispatchEmailChallenge,
  dispatchSmsChallenge,
  submitOtpCode,
  type OtpSessionEntry,
  type OtpVerifyChannel,
  type SubmitOtpError,
} from '@/resources/otp/otp.service';
import { threadParams, loginBounceTarget } from '@/resources/shared/next-step-params';
import { providerForRequest } from '@/server/auth-context.server';
import { assertCsrf, loaderCsrf } from '@/server/csrf';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';

// ── Config + data shapes ──────────────────────────────────────────────────────

export interface OtpVerifyConfig {
  /** OTP channel passed to submitOtpCode + used to select the challenge dispatcher. */
  channel: OtpVerifyChannel;
  /** Email link path: skip the (re)dispatch when ?code is present (the code is already in hand). */
  suppressChallengeOnCode?: boolean;
  /** Only email reads ?next and supports the next=passkey post-verify redirect. */
  nextParamHandling?: 'passkey-redirect' | 'none';
  /** Last-used-login hint to write on success. email ⇒ 'email'; sms/authenticator ⇒ false. */
  writeLastUsedLogin?: 'email' | false;
  /** This screen's own path (literal — resources must not import @/routes/paths). Used for resend. */
  verifyPath: string;
}

export interface OtpVerifyLoaderData {
  csrfToken: string;
  code: string;
  next: string | undefined;
}

export type OtpVerifyActionData = { error: SubmitOtpError };

// ── Challenge dispatch (channel-selected; keeps the route configs thin) ─────────

/** authenticator has no server-sent challenge; email/sms do. */
function channelHasChallenge(channel: OtpVerifyChannel): boolean {
  return channel === 'email' || channel === 'sms';
}

async function dispatchChallenge(
  provider: AuthProvider,
  entry: OtpSessionEntry,
  channel: OtpVerifyChannel,
  ctx: { origin: string; loginName: string; requestId?: string; organization?: string }
): Promise<void> {
  if (channel === 'email') {
    await dispatchEmailChallenge(provider, entry, ctx);
  } else if (channel === 'sms') {
    await dispatchSmsChallenge(provider, entry, ctx.loginName);
  }
  // authenticator: no challenge to send.
}

// ── Factory ───────────────────────────────────────────────────────────────────

// Return type is intentionally inferred — DataWithResponseInit is not exported from
// react-router's public API. Route components use the exported OtpVerify* types.
export function createOtpVerifyHandlers(cfg: OtpVerifyConfig) {
  async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const loginName = url.searchParams.get('loginName') ?? '';
    const requestId = url.searchParams.get('requestId') ?? undefined;
    const organization = url.searchParams.get('organization') ?? undefined;
    // Pre-fill the code only on the email link path; other channels never carry ?code.
    const code = cfg.suppressChallengeOnCode ? (url.searchParams.get('code') ?? '') : '';
    const next =
      cfg.nextParamHandling === 'passkey-redirect'
        ? (url.searchParams.get('next') ?? undefined)
        : undefined;

    // Guard: require an active session for this loginName.
    const sessions = await readSessions(request);
    const entry = byLoginName(sessions, loginName, organization);
    // Bounce to /login WITH the ceremony context (requestId/organization, parsed above) so a
    // dead session mid-OIDC/SAML/device ceremony can still resume after re-login — resources
    // must not import @/routes/paths, so this mirrors routes/login-bounce.ts's redirectToLogin
    // logic locally rather than importing it.
    if (!entry) return redirect(loginBounceTarget(requestId, organization));

    // Send the challenge on first arrival. Suppress the duplicate send on the email link
    // path (code present) so a re-send doesn't rotate/invalidate the in-hand code.
    if (channelHasChallenge(cfg.channel) && !(cfg.suppressChallengeOnCode && code)) {
      await dispatchChallenge(providerForRequest(request), entry, cfg.channel, {
        origin: trustedAppOrigin(request),
        loginName,
        requestId,
        organization,
      });
    }

    const { csrfToken, headers } = await loaderCsrf(request);
    return data<OtpVerifyLoaderData>({ csrfToken, code, next }, { headers });
  }

  async function action({ request }: ActionFunctionArgs) {
    const provider = providerForRequest(request);
    const form = await request.formData();
    await assertCsrf(request, form);

    const formEntries = Object.fromEntries(form);
    const loginName = (formEntries.loginName as string) ?? '';
    const requestId = (formEntries.requestId as string) || undefined;
    const organization = (formEntries.organization as string) || undefined;
    const intent = (formEntries.intent as string) || undefined;

    // Resend: re-navigate to this verify screen WITHOUT ?code so the loader sends a
    // fresh challenge (the action itself does not dispatch — avoids a double-send).
    if (intent === 'resend' && channelHasChallenge(cfg.channel)) {
      return redirect(`${cfg.verifyPath}?${threadParams(loginName, requestId, organization)}`);
    }

    const sessions = await readSessions(request);
    const entry = byLoginName(sessions, loginName, organization);

    const result = await submitOtpCode(provider, cfg.channel, formEntries, entry ?? undefined);
    if (!result.ok) {
      const status = result.error === 'INVALID_CREDENTIALS' ? 401 : 400;
      return data<OtpVerifyActionData>({ error: result.error }, { status });
    }

    // Write back the (potentially rotated) session token.
    const updatedSessions = addSession(sessions, {
      ...entry!,
      token: result.session.token,
      changeTs: result.session.changedAt,
      expirationTs: result.session.expiresAt,
    });

    const headers = new Headers();
    headers.append('set-cookie', await serializeSessions(updatedSessions));
    if (cfg.writeLastUsedLogin) {
      headers.append('set-cookie', await serializeLastUsedLogin(cfg.writeLastUsedLogin));
      headers.append('set-cookie', await serializePasskeyHint(loginName));
    }

    // email only: continue passkey enrollment when requested.
    const nextParam = String(formEntries.next ?? '');
    if (cfg.nextParamHandling === 'passkey-redirect' && nextParam === 'passkey') {
      const p = new URLSearchParams({ loginName, force: 'false', checkAfter: 'false' });
      if (organization) p.set('organization', organization);
      if (requestId) p.set('requestId', requestId);
      return redirect(`/setup/passkey?${p.toString()}`, { headers });
    }

    return redirect(result.target, { headers });
  }

  return { loader, action };
}
