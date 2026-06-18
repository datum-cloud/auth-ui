import { AuthCard } from '@/components/auth-card/auth-card';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import { readSessions } from '@/modules/auth/session/cookie';
import type { ProviderCapabilities } from '@/modules/auth/types';
import { resolveMfaSetup, recordMfaSetupSkip } from '@/resources/mfa';
import { setupSkipSchema } from '@/resources/mfa/mfa.schema';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { Trans } from '@lingui/react/macro';
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm, Link } from 'react-router';

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

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;
  const { force, checkAfter } = setupSkipSchema.parse(Object.fromEntries(url.searchParams));

  // Service resolves the session guard, user lookup, and the capability + login-policy gating
  // (Bug C-setup), returning either a redirect or the offerable enrollment KEYS. The route only
  // reads the cookie, mints the CSRF token, and wires the result to a redirect or rendered chooser.
  const provider = providerForRequest(request);
  const sessions = await readSessions(request);
  const result = await resolveMfaSetup(provider, sessions, { loginName, organization });
  if (result.kind === 'redirect') return redirect(result.target);

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data(
    {
      csrfToken,
      loginName,
      requestId,
      organization,
      force,
      checkAfter,
      offerableKeys: result.offerableKeys,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  // Service parses (loginName/requestId/organization only — force/checkAfter are loader
  // concerns the Skip ignores), resolves session + user, stamps the skip, and computes the
  // next-step target. The route reads the cookie, validates CSRF, and wires the result:
  // success redirects, INVALID_INPUT/SESSION_EXPIRED render a 400 the component reads.
  const sessions = await readSessions(request);
  const result = await recordMfaSetupSkip(provider, sessions, Object.fromEntries(form));
  if (result.ok) return redirect(result.target);
  return data({ error: result.error }, { status: 400 });
}

export default function SetupMfa() {
  const { csrfToken, loginName, requestId, organization, force, checkAfter, offerableKeys } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

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

        {errorMessage ? (
          <p role="alert" className="text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

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
