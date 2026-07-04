import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { useAuthActionRecovery } from '@/hooks/use-auth-action-recovery';
import { readSessions } from '@/modules/auth/session/cookie';
import type { ProviderCapabilities } from '@/modules/auth/types';
import { resolveMfaSetup, recordMfaSetupSkip } from '@/resources/mfa';
import { setupSkipSchema } from '@/resources/mfa/mfa.schema';
import { readCeremonyParams } from '@/resources/shared/ceremony-params';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { assetUrl } from '@/utils/asset-url';
import { Button, LinkButton } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { cn } from '@datum-cloud/datum-ui/utils';
import { Trans } from '@lingui/react/macro';
import { UserKey, KeyRound, Mail, MessageSquareMore } from 'lucide-react';
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
 * Maps each capability flag to its /setup/* typed path builder and display label.
 * Adding a capability without providing a label here is a compile error — the
 * label field is required on every entry. The `path` builder threads the shared
 * query string and emits the byte-identical /setup/<seg> URL.
 */
const CAPABILITY_ROUTES: Array<{
  key: keyof ProviderCapabilities;
  path: (qs: string) => string;
  label: React.ReactNode;
  icon: React.ReactNode;
}> = [
  {
    key: 'passkey',
    path: (qs) => `${paths.setup.passkey()}?${qs}`,
    label: <Trans>Passkey</Trans>,
    icon: <Icon icon={UserKey} />,
  },
  {
    key: 'u2f',
    path: (qs) => `${paths.setup.securityKey()}?${qs}`,
    label: <Trans>Security key</Trans>,
    icon: <Icon icon={KeyRound} size={16} />,
  },
  {
    key: 'totpOtp',
    path: (qs) => `${paths.setup.authenticator()}?${qs}`,
    label: <Trans>Authenticator app</Trans>,
    // Decorative icon: the link's accessible name comes from its visible "Authenticator app"
    // text, so the img MUST be alt="" + aria-hidden — otherwise a screen reader announces the
    // name twice ("Authenticator app Authenticator app"). The Icon-based rows are already
    // decorative SVGs with no accessible name, so only this <img> needed fixing.
    icon: (
      <img
        src={assetUrl('/images/idps/totp.png')}
        alt=""
        aria-hidden="true"
        className="size-4 object-contain"
      />
    ),
  },
  {
    key: 'emailOtp',
    path: (qs) => `${paths.setup.email()}?${qs}`,
    label: <Trans>Email OTP</Trans>,
    icon: <Icon icon={Mail} size={16} />,
  },
  {
    key: 'smsOtp',
    path: (qs) => `${paths.setup.sms()}?${qs}`,
    label: <Trans>SMS OTP</Trans>,
    icon: <Icon icon={MessageSquareMore} size={16} />,
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const { loginName, requestId, organization } = readCeremonyParams(url);
  // Never throw a 500 on tampered query params — an invalid force/checkAfter degrades to undefined.
  const skip = setupSkipSchema.safeParse(Object.fromEntries(url.searchParams));
  const { force, checkAfter } = skip.success ? skip.data : {};

  // Service resolves the session guard, user lookup, and the capability + login-policy gating,
  // returning either a redirect or the offerable enrollment KEYS. The route only
  // reads the cookie, mints the CSRF token, and wires the result to a redirect or rendered chooser.
  const provider = providerForRequest(request);
  const sessions = await readSessions(request);
  const result = await resolveMfaSetup(provider, sessions, { loginName, organization });
  if (result.kind === 'redirect') return redirect(result.target);

  const { csrfToken, headers } = await loaderCsrf(request);

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

  // Resolve the inline message + a recovery <Link> for recoverable codes
  // (SESSION_EXPIRED → "Sign in again").
  const { message: errorMessage, recovery } = useAuthActionRecovery(actionData, {
    requestId,
    organization,
  });

  // Build query params that thread through to each enrollment screen.
  const sharedParams = new URLSearchParams({ loginName });
  if (requestId) sharedParams.set('requestId', requestId);
  if (organization) sharedParams.set('organization', organization);
  if (force) sharedParams.set('force', force);
  if (checkAfter) sharedParams.set('checkAfter', checkAfter);
  const qs = sharedParams.toString();

  // The loader already applied the capability + login-policy gate and sent the
  // offerable KEYS. Re-derive the renderable routes (with their non-serializable JSX labels)
  // by filtering CAPABILITY_ROUTES — the keys are the single source of truth for WHICH rows show.
  const offerableKeySet = new Set(offerableKeys);
  const offerableRoutes = CAPABILITY_ROUTES.filter((r) => offerableKeySet.has(r.key));

  return (
    <AuthCeremony
      title={<Trans>Set up multi-factor authentication</Trans>}
      description={
        <Trans>Add an extra layer of security to your account by setting up a second factor.</Trans>
      }
      error={errorMessage}
      recovery={recovery}
      loginName={loginName}
      requestId={requestId}
      organization={organization}
      showBackLink={false}>
      <div className="flex w-full flex-col gap-3">
        {/* LinkButton (single styled <a>) — NOT Button asChild, which emits
            <button><a> (nested-interactive axe violation in the prod build). These
            are navigation links to each enroll route, not form submits. */}
        {offerableRoutes.map((r) => (
          <LinkButton
            key={r.key}
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            iconPosition="left"
            icon={r.icon}
            as={Link}
            href={r.path(qs)}>
            <Trans>{r.label}</Trans>
          </LinkButton>
        ))}
      </div>

      {force !== 'true' ? (
        <RRForm method="POST" className="w-full">
          <AuthFormFields
            csrf={csrfToken}
            loginName={loginName}
            requestId={requestId}
            organization={organization}
          />
          {force ? <input type="hidden" name="force" value={force} /> : null}
          {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
          {/* Real form submit — no asChild (the child is text, not an element to
              clone; asChild here was a no-op that risked a Slot child-count error). */}
          <Button
            className={cn(offerableRoutes.length > 0 && 'mt-3')}
            type="quaternary"
            theme="link"
            block
            htmlType="submit">
            <Trans>Skip for now</Trans>
          </Button>
        </RRForm>
      ) : null}
    </AuthCeremony>
  );
}
