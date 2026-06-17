import { nextStepWithParams } from './_shared/next-step-params';
import { AuthCard } from '@/components/auth-card';
import { setupSkipSchema } from '@/flows/mfa-schemas';
import type { AuthMethod, LoginSettings, ProviderCapabilities } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent, hashActor } from '@/server/observability';
import { readSessions, byLoginName } from '@/session/cookie';
import { Trans } from '@lingui/react/macro';
import {
  data,
  redirect,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm, Link } from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Set up multi-factor authentication' }];

/**
 * Maps each capability flag to its /setup/* route segment and display label.
 * Adding a capability without providing a label here is a compile error — the
 * label field is required on every entry.
 */
const CAPABILITY_ROUTES: Array<{
  key: keyof ProviderCapabilities;
  path: string;
  label: React.ReactNode;
}> = [
  { key: 'passkey', path: 'passkey', label: <Trans>Passkey</Trans> },
  { key: 'u2f', path: 'security-key', label: <Trans>Security key</Trans> },
  { key: 'totpOtp', path: 'authenticator', label: <Trans>Authenticator app</Trans> },
  { key: 'emailOtp', path: 'email', label: <Trans>Email OTP</Trans> },
  { key: 'smsOtp', path: 'sms', label: <Trans>SMS OTP</Trans> },
];

/**
 * Bug C-setup (C6): which login-policy set governs each capability key, and the neutral
 * AuthMethod it must appear in to be policy-allowed.
 *  - passkey is a MULTI-factor (proto multiFactors → 'passkey'), NOT a second factor.
 *  - u2f / totpOtp / emailOtp / smsOtp are SECOND factors (proto secondFactors).
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

/**
 * Returns the capability KEYS that should be offered: gated by BOTH the provider's static
 * capability AND the org login policy. When the relevant policy set is undefined (fake/older
 * settings) the policy gate is skipped → capabilities-only (back-compat).
 *
 * Returns KEYS (not route objects) so the LOADER can call this purely server-side: the route
 * objects carry JSX `label` fields which are NOT serializable across the loader boundary. The
 * component re-derives the renderable routes by filtering CAPABILITY_ROUTES with these keys.
 */
export function offerableSetupRoutes(
  capabilities: ProviderCapabilities,
  settings: LoginSettings
): Array<keyof ProviderCapabilities> {
  return CAPABILITY_ROUTES.filter((r) => {
    if (!capabilities[r.key]) return false;
    const gate = POLICY_GATE[r.key];
    if (!gate) return false;
    const policy = gate.set === 'second' ? settings.secondFactors : settings.multiFactors;
    // undefined policy set → no restriction (back-compat); otherwise must be listed.
    return policy === undefined ? true : policy.includes(gate.method);
  }).map((r) => r.key);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;
  const { force, checkAfter } = setupSkipSchema.parse(Object.fromEntries(url.searchParams));

  // Guard: require an active session for this loginName.
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect('/login');

  const provider = providerForRequest(request);
  const user = await provider.findUser(loginName, organization);
  if (!user) return redirect('/login');

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  // Capabilities determine which enrollment methods the provider supports; the org login
  // policy further gates which of those are actually enabled (Bug C-setup / C6). The filtering
  // is pure and server-only, so compute the offerable KEYS here and ship just those — never the
  // raw policy arrays. (Keys, not route objects: the route labels are non-serializable JSX.)
  const capabilities = provider.capabilities;
  const settings = await provider.getLoginSettings(organization);
  const offerableKeys = offerableSetupRoutes(capabilities, settings);

  return data(
    {
      csrfToken,
      loginName,
      requestId,
      organization,
      force,
      checkAfter,
      offerableKeys,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  // Skip action only reads loginName/requestId/organization.
  // force and checkAfter are loader concerns — the Skip path ignores them deliberately.
  const parsed = z
    .object({
      loginName: z.string().min(1),
      requestId: z.string().optional(),
      organization: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const loginNameRaw = (form.get('loginName') as string | null) ?? '';
    logAuthEvent('mfa_skip', 'failure', {
      actor: hashActor(loginNameRaw),
      reason: 'invalid_input',
    });
    return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  }

  const { loginName, requestId, organization } = parsed.data;

  // Resolve session + user.
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) {
    logAuthEvent('mfa_skip', 'failure', { actor: hashActor(loginName), reason: 'session_expired' });
    return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });
  }

  const user = await provider.findUser(loginName, organization);
  if (!user) {
    logAuthEvent('mfa_skip', 'failure', { actor: hashActor(loginName), reason: 'session_expired' });
    return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });
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
    return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });
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

  return redirect(target);
}

export default function SetupMfa() {
  const { csrfToken, loginName, requestId, organization, force, checkAfter, offerableKeys } =
    useLoaderData<typeof loader>();

  // Build query params that thread through to each enrollment screen.
  const sharedParams = new URLSearchParams({ loginName });
  if (requestId) sharedParams.set('requestId', requestId);
  if (organization) sharedParams.set('organization', organization);
  if (force) sharedParams.set('force', force);
  if (checkAfter) sharedParams.set('checkAfter', checkAfter);
  const qs = sharedParams.toString();

  // The loader already applied the capability + login-policy gate (Bug C-setup) and sent the
  // offerable KEYS. Re-derive the renderable routes (with their non-serializable JSX labels)
  // by filtering CAPABILITY_ROUTES — the keys are the single source of truth for WHICH rows show.
  const offerableKeySet = new Set(offerableKeys);
  const offerableRoutes = CAPABILITY_ROUTES.filter((r) => offerableKeySet.has(r.key));

  return (
    <AuthCard
      title={<Trans>Set up multi-factor authentication</Trans>}
      description={
        <Trans>Add an extra layer of security to your account by setting up a second factor.</Trans>
      }>
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {offerableRoutes.map((r) => (
            <li key={r.path}>
              <Link
                to={`/setup/${r.path}?${qs}`}
                className="border-border hover:bg-muted flex w-full items-center justify-between rounded-md border px-4 py-3 text-sm font-medium transition-colors">
                {r.label}
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>

        {force !== 'true' ? (
          <RRForm method="POST">
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="loginName" value={loginName} />
            {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
            {organization ? <input type="hidden" name="organization" value={organization} /> : null}
            {force ? <input type="hidden" name="force" value={force} /> : null}
            {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
            <button
              type="submit"
              className="border-border text-muted-foreground hover:bg-muted w-full rounded-md border px-4 py-2 text-sm transition-colors">
              <Trans>Skip for now</Trans>
            </button>
          </RRForm>
        ) : null}
      </div>
    </AuthCard>
  );
}
