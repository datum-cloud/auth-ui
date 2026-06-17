// app/resources/device/device.service.ts
//
// Pass 2 extraction: the /device and /device/authorize loader/action BUSINESS logic —
// device-code parsing + lookup, consent-screen data shaping, the session gate, the
// `deviceDecision` mapping, the provider authorizeDevice call, and the ProviderError →
// outcome mapping (NOT_FOUND → friendly 404, any other code → 502). React rendering, the
// CSRF assertion, and the final redirect()/data() construction stay thin in the routes.
//
// As with the authorize domain, each entrypoint resolves to a typed `Outcome` and a pure
// `outcomeToResponse` translator turns it into the redirect/JSON Response the route returns
// verbatim — so every status/redirect/payload assertion is testable at the service boundary.
//
// The seed flow `device-decision.ts` (deviceDecision) is re-exported through the barrel; the
// service builds the authorize orchestration around it.
import { codeSchema } from './device.schema';
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { readSessions, mostRecent, type SessionEntry } from '@/modules/auth/session/cookie';
import { ProviderError } from '@/modules/auth/types';
import { deviceDecision } from '@/resources/device/device-decision';
import { logAuthEvent, hashActor } from '@/server/observability';
import { data, redirect } from 'react-router';
import { z } from 'zod';

// advisory client-side gate AND the authoritative server-side gate.
// Device codes vary in format across providers; keep this intentionally loose.

export const decisionSchema = z.object({
  decision: z.enum(['authorize', 'deny']),
  deviceAuthId: z.string().min(1),
  requestId: z.string().regex(/^device_/),
});

// ── /device (code lookup) ───────────────────────────────────────────────────────

/**
 * Typed outcome of the /device action. The route turns it into a Response via
 * `lookupOutcomeToResponse`: a redirect to the consent screen on success, or a `data()`
 * error with the appropriate status.
 */
export type DeviceLookupOutcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'error'; error: 'invalid_code'; status: 400 }
  | { kind: 'error'; error: 'not_found'; status: 404 };

/**
 * Resolve a /device code submission to a typed outcome. Owns the entire action business
 * logic: validate the user code, look up the device auth, map provider NOT_FOUND to a
 * friendly 404, and (on success) build the redirect to /device/authorize.
 *
 * requestId carries the STABLE user code, not deviceAuth.id: the Zitadel adapter returns a
 * different opaque id per getDeviceAuth call, so the user code is the only handle the ceremony
 * can re-resolve after a login round-trip.
 */
export async function lookupDeviceCode(
  provider: AuthProvider,
  form: FormData
): Promise<DeviceLookupOutcome> {
  const parsed = codeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    logAuthEvent('device_code_lookup', 'failure', { reason: 'invalid_code' });
    return { kind: 'error', error: 'invalid_code', status: 400 };
  }

  const { userCode } = parsed.data;

  let deviceAuth;
  try {
    deviceAuth = await provider.getDeviceAuth(userCode);
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'NOT_FOUND') {
      logAuthEvent('device_code_lookup', 'failure', { reason: 'not_found' });
      return { kind: 'error', error: 'not_found', status: 404 };
    }
    throw error;
  }

  logAuthEvent('device_code_lookup', 'success', { deviceAuthId: deviceAuth.id });

  const params = new URLSearchParams({
    requestId: `device_${userCode}`,
    user_code: userCode,
  });
  return { kind: 'redirect', location: `/device/authorize?${params.toString()}` };
}

/** Turn a DeviceLookupOutcome into the Response the /device route returns. */
export function lookupOutcomeToResponse(outcome: DeviceLookupOutcome) {
  if (outcome.kind === 'redirect') return redirect(outcome.location);
  return data({ error: outcome.error }, { status: outcome.status });
}

// ── /device/authorize loader (consent screen data) ───────────────────────────────

export interface DeviceConsent {
  appName: string;
  scope: string[];
  deviceAuthId: string;
  // STABLE user code, not deviceAuth.id: the Zitadel adapter returns a different opaque id per
  // getDeviceAuth call. When the unauthenticated-consent path bounces through /login, the
  // ceremony threads this requestId back to /authorize, which re-derives ?user_code= for this
  // screen (post-login return-to-consent).
  requestId: string;
}

/**
 * Resolve the /device/authorize loader business logic: require ?user_code=, resolve the device
 * auth, and shape the consent payload. Throws a `data(...)` Response for the two friendly error
 * paths (missing user_code → 400; stale/tampered code → 404) exactly as the route did, so the
 * route loader stays a thin parse → service → respond.
 */
export async function loadDeviceConsent(
  provider: AuthProvider,
  request: Request
): Promise<DeviceConsent> {
  const url = new URL(request.url);
  const userCode = url.searchParams.get('user_code');
  if (!userCode) {
    throw data('missing user_code', { status: 400 });
  }

  let req;
  try {
    req = await provider.getDeviceAuth(userCode);
  } catch (error) {
    // stale deep-link / tampered user_code — friendly 404 instead of a raw error boundary
    if (error instanceof ProviderError && error.code === 'NOT_FOUND') {
      throw data('device_auth_not_found', { status: 404 });
    }
    throw error;
  }

  return {
    appName: req.appName ?? '',
    scope: req.scope,
    deviceAuthId: req.id,
    requestId: `device_${userCode}`,
  };
}

// ── /device/authorize action (consent decision) ──────────────────────────────────

/**
 * Typed outcome of the /device/authorize action. The route turns it into a Response via
 * `decisionOutcomeToResponse`: a redirect to /login (unauthenticated authorize), a `data()`
 * success carrying the decision, or a `data()` error with the appropriate status.
 */
export type DeviceDecisionOutcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'done'; decision: 'authorize' | 'deny' }
  | { kind: 'error'; error: 'invalid_input'; status: 400 }
  | { kind: 'error'; error: 'provider_error'; status: 502 };

/**
 * Resolve a /device/authorize decision submission to a typed outcome. Owns the entire action
 * business logic: validate the decision input, read the session, gate authorize on a signed-in
 * session (sessionless deny is deliberate — denial is fail-safe and mirrors RFC 8628 consent
 * semantics), map the decision via the `deviceDecision` seed, call the provider, and map
 * ProviderError to a displayable 502.
 */
export async function resolveDeviceDecision(
  provider: AuthProvider,
  request: Request,
  form: FormData
): Promise<DeviceDecisionOutcome> {
  const parsed = decisionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    logAuthEvent('device_authorize', 'failure', { reason: 'invalid_input' });
    return { kind: 'error', error: 'invalid_input', status: 400 };
  }

  const { decision, deviceAuthId, requestId } = parsed.data;

  const sessions = await readSessions(request);
  const entry: SessionEntry | undefined = mostRecent(sessions);

  // Only authorize requires a signed-in session. Sessionless deny is deliberate:
  // denial is fail-safe (revokes, never grants) and mirrors the fork's RFC 8628
  // consent semantics — a user who refuses to sign in can still reject the device.
  if (decision === 'authorize' && !entry) {
    return { kind: 'redirect', location: `/login?requestId=${encodeURIComponent(requestId)}` };
  }

  try {
    await provider.authorizeDevice(
      deviceAuthId,
      deviceDecision({
        decision,
        session: entry ? { id: entry.id, token: entry.token } : undefined,
      })
    );
  } catch (error) {
    // stale deviceAuthId / provider outage — audit + render a displayable error
    if (error instanceof ProviderError) {
      logAuthEvent('device_authorize', 'failure', {
        decision,
        deviceAuthId,
        requestId,
        reason: error.code,
      });
      return { kind: 'error', error: 'provider_error', status: 502 };
    }
    throw error;
  }

  logAuthEvent('device_authorize', 'success', {
    decision,
    deviceAuthId,
    requestId,
    actor: entry?.loginName ? hashActor(entry.loginName) : undefined,
  });

  return { kind: 'done', decision };
}

/** Turn a DeviceDecisionOutcome into the Response the /device/authorize route returns. */
export function decisionOutcomeToResponse(outcome: DeviceDecisionOutcome) {
  switch (outcome.kind) {
    case 'redirect':
      return redirect(outcome.location);
    case 'done':
      return data({ done: outcome.decision });
    case 'error':
      return data({ error: outcome.error }, { status: outcome.status });
  }
}
