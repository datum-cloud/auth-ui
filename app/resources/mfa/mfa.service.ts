// app/resources/mfa/mfa.service.ts
//
// Pass 2 extraction: the loader/action BUSINESS logic for the mfa domain
// (the /login/mfa chooser and /setup/mfa enrollment+skip flows). React rendering,
// CSRF/cookie I/O, and the route's redirect()/data() wiring stay in the route
// modules; everything here takes a provider + already-read sessions + plain inputs
// and returns a typed result.
//
// The pure routing/policy helpers (mfa-routing.ts) and the zod schemas (mfa.schema.ts)
// were relocated into this folder during Pass 1 — the service builds around them and
// the barrel (index.ts) re-exports them so callers/tests reach the whole domain through
// one specifier.
import {
  SECOND_FACTOR_METHODS,
  USE_SCREEN,
  intersectWithPolicy,
  type SecondFactorMethod,
} from './mfa-routing';
import { secondFactorMethodSchema } from './mfa.schema';
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { byLoginName, type SessionEntry } from '@/modules/auth/session/cookie';
import type { AuthMethod, LoginSettings, ProviderCapabilities } from '@/modules/auth/types';
import { nextStepWithParams, threadParams } from '@/resources/shared/next-step-params';
import { logAuthEvent, hashActor } from '@/server/observability';
import { z } from 'zod';

// ── /login/mfa loader: resolve the chooser ────────────────────────────────────

export interface MfaPickerInput {
  loginName: string;
  requestId?: string;
  organization?: string;
}

/** A request to redirect away from the chooser (no session, no user, or single factor). */
export interface MfaPickerRedirect {
  kind: 'redirect';
  target: string;
}

/** The data the chooser renders: the enrolled-and-policy-allowed second factors. */
export interface MfaPickerData {
  kind: 'picker';
  secondFactors: SecondFactorMethod[];
}

export type MfaPickerResult = MfaPickerRedirect | MfaPickerData;

/**
 * Resolve the /login/mfa chooser for an already-read sessions list.
 *
 * Guard: require an active session for this loginName; resolve userId via findUser
 * (the SessionEntry carries no userId field). Either guard failing → redirect('/login').
 *
 * Filters the user's enrolled methods to 2nd factors only (password/passkey/idp
 * excluded), then intersects with the org login policy's allowed secondFactors
 * (Bug C / C4 — shared gate via intersectWithPolicy; undefined/empty policy →
 * enrolled-only, back-compat). Exactly one allowed factor → redirect straight to its
 * use screen; otherwise return the list for the chooser to render.
 *
 * CSRF token + Set-Cookie header are the route's concern (only emitted on the picker
 * branch), so they are NOT part of this result.
 */
export async function resolveMfaPicker(
  provider: AuthProvider,
  sessions: SessionEntry[],
  { loginName, requestId, organization }: MfaPickerInput
): Promise<MfaPickerResult> {
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return { kind: 'redirect', target: '/login' };

  const user = await provider.findUser(loginName, organization);
  if (!user) return { kind: 'redirect', target: '/login' };

  const [allMethods, settings] = await Promise.all([
    provider.listAuthMethods(user.id),
    provider.getLoginSettings(organization),
  ]);

  // Filter to enrolled 2nd-factor methods only (password/passkey/idp excluded).
  const enrolled = allMethods.filter((m): m is SecondFactorMethod =>
    (SECOND_FACTOR_METHODS as readonly string[]).includes(m)
  );

  // Bug C (C4): never list a method the org login policy has disabled. Shared gate
  // (see intersectWithPolicy): undefined/empty policy → enrolled-only (back-compat).
  const secondFactors = intersectWithPolicy(enrolled, settings.secondFactors);

  // Short-circuit: exactly one 2nd factor enrolled → redirect straight to its use screen.
  if (secondFactors.length === 1) {
    const qs = threadParams(loginName, requestId, organization);
    return { kind: 'redirect', target: `${USE_SCREEN[secondFactors[0]]}?${qs}` };
  }

  return { kind: 'picker', secondFactors };
}

// ── /login/mfa action: choose a 2nd-factor method ─────────────────────────────

export type ChooseMfaMethodError = 'SESSION_EXPIRED' | 'INVALID_INPUT';

export type ChooseMfaMethodResult =
  | { ok: true; target: string }
  | { ok: false; error: ChooseMfaMethodError };

/**
 * Parse + route a 2nd-factor-method choice for an already-read sessions list.
 *
 * Guard: active session required (→ SESSION_EXPIRED, with a session_expired audit
 * failure). Schema-validate the chosen method (→ INVALID_INPUT, invalid_input audit
 * failure).
 *
 * Best-effort userId for the audit log: a findUser failure must NOT abort routing,
 * but it must be observable — emit a failure audit line keyed on the
 * HASHED actor (never the raw loginName) and continue. On success emit the
 * success routing event and return the matching use-screen target.
 */
export async function chooseMfaMethod(
  provider: AuthProvider,
  sessions: SessionEntry[],
  formEntries: Record<string, unknown>,
  input: MfaPickerInput
): Promise<ChooseMfaMethodResult> {
  const { loginName, requestId, organization } = input;

  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) {
    logAuthEvent('mfa_method_chosen', 'failure', { loginName, reason: 'session_expired' });
    return { ok: false, error: 'SESSION_EXPIRED' };
  }

  const parsed = secondFactorMethodSchema.safeParse(formEntries);
  if (!parsed.success) {
    logAuthEvent('mfa_method_chosen', 'failure', { loginName, reason: 'invalid_input' });
    return { ok: false, error: 'INVALID_INPUT' };
  }

  const { method: secondFactorMethod } = parsed.data;

  // Best-effort userId for the audit log — not required for routing.
  let userId = '';
  try {
    const user = await provider.findUser(loginName, organization);
    userId = user?.id ?? '';
  } catch (err) {
    // Don't silently swallow a findUser failure — the userId is best-effort
    // for the audit log, but the failure itself must be observable. Routing continues.
    logAuthEvent('mfa_method_chosen', 'failure', {
      actor: hashActor(loginName),
      reason: err instanceof Error ? err.message : 'finduser_failed',
    });
  }

  logAuthEvent('mfa_method_chosen', 'success', { userId, method: secondFactorMethod });

  const qs = threadParams(loginName, requestId, organization);
  return { ok: true, target: `${USE_SCREEN[secondFactorMethod]}?${qs}` };
}

// ── /setup/mfa loader: which enrollment rows to offer ─────────────────────────

/**
 * Bug C-setup (C6): which login-policy set governs each capability key, and the neutral
 * AuthMethod it must appear in to be policy-allowed.
 *  - passkey is a MULTI-factor (proto multiFactors → 'passkey'), NOT a second factor.
 *  - u2f / totpOtp / emailOtp / smsOtp are SECOND factors (proto secondFactors).
 *
 * Keyed in the canonical row order so `offerableSetupRoutes` preserves it.
 */
const POLICY_GATE: Record<
  keyof ProviderCapabilities,
  { set: 'second' | 'multi'; method: AuthMethod } | null
> = {
  passkey: { set: 'multi', method: 'passkey' },
  u2f: { set: 'second', method: 'u2f' },
  totpOtp: { set: 'second', method: 'totp' },
  emailOtp: { set: 'second', method: 'otp_email' },
  smsOtp: { set: 'second', method: 'otp_sms' },
  // Non-MFA capabilities are never offered as enrollment rows here.
  externalIdp: null,
  ldap: null,
  saml: null,
  oidc: null,
  registration: null,
};

// Canonical row order for the enrollment chooser. The route owns the JSX labels and the
// /setup/* path segments; the service only decides WHICH keys are offerable (keys are
// serializable across the loader boundary, JSX labels are not).
const SETUP_ROW_ORDER: Array<keyof ProviderCapabilities> = [
  'passkey',
  'u2f',
  'totpOtp',
  'emailOtp',
  'smsOtp',
];

/**
 * Returns the capability KEYS that should be offered: gated by BOTH the provider's static
 * capability AND the org login policy. When the relevant policy set is undefined (fake/older
 * settings) the policy gate is skipped → capabilities-only (back-compat).
 *
 * Returns KEYS (not route objects) so the LOADER can call this purely server-side: the route
 * objects carry JSX `label` fields which are NOT serializable across the loader boundary. The
 * component re-derives the renderable routes from these keys.
 */
export function offerableSetupRoutes(
  capabilities: ProviderCapabilities,
  settings: LoginSettings
): Array<keyof ProviderCapabilities> {
  return SETUP_ROW_ORDER.filter((key) => {
    if (!capabilities[key]) return false;
    const gate = POLICY_GATE[key];
    if (!gate) return false;
    const policy = gate.set === 'second' ? settings.secondFactors : settings.multiFactors;
    // undefined policy set → no restriction (back-compat); otherwise must be listed.
    return policy === undefined ? true : policy.includes(gate.method);
  });
}

export interface MfaSetupInput {
  loginName: string;
  organization?: string;
}

/** A request to redirect away from the setup chooser (no session or no user). */
export interface MfaSetupRedirect {
  kind: 'redirect';
  target: string;
}

/** The data the setup chooser renders: the offerable enrollment capability KEYS. */
export interface MfaSetupData {
  kind: 'setup';
  offerableKeys: Array<keyof ProviderCapabilities>;
}

export type MfaSetupResult = MfaSetupRedirect | MfaSetupData;

/**
 * Resolve the /setup/mfa enrollment chooser for an already-read sessions list.
 *
 * Guard: require an active session for this loginName; resolve the user via findUser
 * (the SessionEntry carries no userId field). Either guard failing → redirect('/login').
 *
 * Capabilities determine which enrollment methods the provider supports; the org login
 * policy further gates which of those are actually enabled (Bug C-setup / C6). The gating
 * is pure and server-only, so compute the offerable KEYS here and ship just those — never
 * the raw policy arrays. (Keys, not route objects: the route labels are non-serializable
 * JSX.)
 *
 * The CSRF token + Set-Cookie header are the route's concern (only emitted on the setup
 * branch), so they are NOT part of this result.
 */
export async function resolveMfaSetup(
  provider: AuthProvider,
  sessions: SessionEntry[],
  { loginName, organization }: MfaSetupInput
): Promise<MfaSetupResult> {
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return { kind: 'redirect', target: '/login' };

  const user = await provider.findUser(loginName, organization);
  if (!user) return { kind: 'redirect', target: '/login' };

  const capabilities = provider.capabilities;
  const settings = await provider.getLoginSettings(organization);
  const offerableKeys = offerableSetupRoutes(capabilities, settings);

  return { kind: 'setup', offerableKeys };
}

// ── /setup/mfa action: skip enrollment ────────────────────────────────────────

const skipFormSchema = z.object({
  loginName: z.string().min(1),
  requestId: z.string().optional(),
  organization: z.string().optional(),
});

export type RecordMfaSetupSkipError = 'INVALID_INPUT' | 'SESSION_EXPIRED';

export type RecordMfaSetupSkipResult =
  | { ok: true; target: string }
  | { ok: false; error: RecordMfaSetupSkipError };

/**
 * Parse + perform an MFA-setup skip for an already-read sessions list.
 *
 * The Skip path only reads loginName/requestId/organization (force/checkAfter are loader
 * concerns the Skip deliberately ignores). Validation failure → INVALID_INPUT with an
 * invalid_input audit line keyed on the hashed actor.
 *
 * Resolves session + user; either missing → SESSION_EXPIRED (session_expired audit). On a
 * valid skip: stamp the skip timestamp (setMfaInitSkipped), re-fetch the user so
 * mfaInitSkippedAt is fresh, resolve the next step from the current session state, and
 * return the redirect target.
 */
export async function recordMfaSetupSkip(
  provider: AuthProvider,
  sessions: SessionEntry[],
  formEntries: Record<string, unknown>
): Promise<RecordMfaSetupSkipResult> {
  const parsed = skipFormSchema.safeParse(formEntries);
  if (!parsed.success) {
    const loginNameRaw = typeof formEntries.loginName === 'string' ? formEntries.loginName : '';
    logAuthEvent('mfa_skip', 'failure', {
      actor: hashActor(loginNameRaw),
      reason: 'invalid_input',
    });
    return { ok: false, error: 'INVALID_INPUT' };
  }

  const { loginName, requestId, organization } = parsed.data;

  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) {
    logAuthEvent('mfa_skip', 'failure', { actor: hashActor(loginName), reason: 'session_expired' });
    return { ok: false, error: 'SESSION_EXPIRED' };
  }

  const user = await provider.findUser(loginName, organization);
  if (!user) {
    logAuthEvent('mfa_skip', 'failure', { actor: hashActor(loginName), reason: 'session_expired' });
    return { ok: false, error: 'SESSION_EXPIRED' };
  }

  const userId = user.id;

  // Record the skip timestamp.
  await provider.setMfaInitSkipped(userId);
  logAuthEvent('mfa_skip', 'success', { userId });

  // Re-fetch user so mfaInitSkippedAt is fresh (fake stamps FIXED_NOW in setMfaInitSkipped).
  const refreshedUser = await provider.findUser(loginName, organization);

  // Resolve next step from current session state.
  const session = await provider.getSession(entry.id, entry.token);
  if (!session) {
    logAuthEvent('mfa_skip', 'failure', { actor: hashActor(loginName), reason: 'session_expired' });
    return { ok: false, error: 'SESSION_EXPIRED' };
  }

  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(userId),
    provider.getLoginSettings(organization),
  ]);

  const target = nextStepWithParams({
    factors: session.factors,
    settings,
    enrolledMethods: methods,
    loginName: session.user?.loginName ?? loginName,
    userVerified: session.factors.passkey?.userVerified ?? false,
    mfaInitSkippedAt: refreshedUser?.mfaInitSkippedAt,
    requestId,
    organization,
  });

  return { ok: true, target };
}

// Re-exported so callers/tests can reach the routing helpers + schemas through the
// domain service. The barrel (index.ts) re-exports these in turn.
export { SECOND_FACTOR_METHODS, USE_SCREEN, intersectWithPolicy, nextMfaStep } from './mfa-routing';
export type { SecondFactorMethod, MfaRoutingInput, MfaRoutingResult } from './mfa-routing';
export {
  secondFactorMethodSchema,
  setupSkipSchema,
  otpCodeSchema,
  otpDeliveryCodeSchema,
  mfaMethodSchema,
  credentialSchema,
} from './mfa.schema';
