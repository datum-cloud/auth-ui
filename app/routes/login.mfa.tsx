import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import {
  SECOND_FACTOR_METHODS,
  USE_SCREEN,
  intersectWithPolicy,
  type SecondFactorMethod,
} from '@/flows/mfa-routing';
import { secondFactorMethodSchema } from '@/flows/mfa-schemas';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent, hashActor } from '@/server/observability';
import { readSessions, byLoginName } from '@/session/cookie';
import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import {
  data,
  redirect,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
  Form as RRForm,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Choose your verification method' }];

// ─── Labels for each 2nd-factor method ───────────────────────────────────────

const METHOD_LABELS: Record<SecondFactorMethod, ReactNode> = {
  totp: <Trans>Authenticator app</Trans>,
  otp_email: <Trans>Email one-time code</Trans>,
  otp_sms: <Trans>SMS one-time code</Trans>,
  u2f: <Trans>Security key</Trans>,
};

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;

  // Guard: require an active session for this loginName (mirror login.verify.authenticator.tsx).
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect('/login');

  const provider = providerForRequest(request);
  // Resolve userId via findUser(loginName) — SessionEntry carries no userId field.
  const user = await provider.findUser(loginName, organization);
  if (!user) return redirect('/login');

  const [allMethods, settings] = await Promise.all([
    provider.listAuthMethods(user.id),
    provider.getLoginSettings(organization),
  ]);

  // Filter to enrolled 2nd-factor methods only (password/passkey/idp excluded).
  const enrolled = allMethods.filter((m): m is SecondFactorMethod =>
    (SECOND_FACTOR_METHODS as readonly string[]).includes(m)
  );

  // Bug C (C4): never list a method the org login policy has disabled. Shared gate (see
  // intersectWithPolicy): undefined/empty policy → enrolled-only (back-compat).
  const secondFactors = intersectWithPolicy(enrolled, settings.secondFactors);

  // Short-circuit: exactly one 2nd factor enrolled → redirect straight to its use screen.
  if (secondFactors.length === 1) {
    const params = new URLSearchParams({ loginName });
    if (requestId) params.set('requestId', requestId);
    if (organization) params.set('organization', organization);
    return redirect(`${USE_SCREEN[secondFactors[0]]}?${params.toString()}`);
  }

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data({ csrfToken, loginName, requestId, organization, secondFactors }, { headers });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form);

  const loginName = (form.get('loginName') as string | null) ?? '';
  const requestId = (form.get('requestId') as string | null) ?? undefined;
  const organization = (form.get('organization') as string | null) ?? undefined;

  // Guard: active session required.
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) {
    logAuthEvent('mfa_method_chosen', 'failure', { loginName, reason: 'session_expired' });
    return redirect('/login');
  }

  const parsed = secondFactorMethodSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    logAuthEvent('mfa_method_chosen', 'failure', { loginName, reason: 'invalid_input' });
    return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  }

  const { method: secondFactorMethod } = parsed.data;

  // Best-effort userId for the audit log — not required for routing.
  const provider = providerForRequest(request);
  let userId = '';
  try {
    const user = await provider.findUser(loginName, organization);
    userId = user?.id ?? '';
  } catch (err) {
    // CODE-MIN-28: don't silently swallow a findUser failure — the userId is best-effort for
    // the audit log, but the failure itself must be observable. Routing continues regardless.
    logAuthEvent('mfa_method_chosen', 'failure', {
      actor: hashActor(loginName),
      reason: err instanceof Error ? err.message : 'finduser_failed',
    });
  }

  logAuthEvent('mfa_method_chosen', 'success', { userId, method: secondFactorMethod });

  const params = new URLSearchParams({ loginName });
  if (requestId) params.set('requestId', requestId);
  if (organization) params.set('organization', organization);

  return redirect(`${USE_SCREEN[secondFactorMethod]}?${params.toString()}`);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MfaPicker() {
  const { csrfToken, loginName, requestId, organization, secondFactors } =
    useLoaderData<typeof loader>();

  return (
    <AuthCard
      title={<Trans>Two-factor verification</Trans>}
      description={<Trans>Choose how you want to verify your identity.</Trans>}>
      <div className="flex flex-col gap-3">
        {secondFactors.map((method) => (
          <RRForm key={method} method="POST">
            <input type="hidden" name="csrf" value={csrfToken} />
            <input type="hidden" name="loginName" value={loginName} />
            <input type="hidden" name="method" value={method} />
            {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
            {organization ? <input type="hidden" name="organization" value={organization} /> : null}
            <SubmitButton>{METHOD_LABELS[method]}</SubmitButton>
          </RRForm>
        ))}
      </div>
    </AuthCard>
  );
}
