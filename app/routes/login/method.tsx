import SplitLayout from '@/layouts/split.layout';
import { decideAfterIdentifier } from '@/resources/login/login-decision';
import { type LoginLayoutData } from '@/routes/login/layout';
import { providerForRequest } from '@/server/auth-context.server';
import { env } from '@/utils/env/env.server';
import { Button } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans } from '@lingui/react/macro';
import { Key, Lock, Mail, UserCircle } from 'lucide-react';
import {
  redirect,
  useLoaderData,
  useRouteLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Choose how to sign in' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);

  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;

  if (!loginName) return redirect('/login');

  const user = await provider.findUser(loginName, organization);
  if (!user) return redirect('/login');

  const [methods, settings] = await Promise.all([
    provider.listAuthMethods(user.id),
    provider.getLoginSettings(organization),
  ]);

  // Compute available primary sign-in methods using the same policy gates as
  // decideAfterIdentifier (login-decision.ts). This screen only appears when
  // available.length >= 2; we surface exactly those available methods.
  const available: Array<'passkey' | 'password' | 'otp_email' | 'idp'> = [];
  if (methods.includes('passkey') && settings.passkeysType !== 'not_allowed')
    available.push('passkey');
  if (methods.includes('idp') && settings.allowExternalIdp) available.push('idp');
  if (methods.includes('password') && settings.allowPassword) available.push('password');
  if (methods.includes('otp_email') && env.AUTH_EMAIL_DELIVERY_ENABLED) available.push('otp_email');

  // Defensive: if for some reason < 2 methods are available, run decideAfterIdentifier
  // and redirect to the single target (or error).
  if (available.length < 2) {
    const decision = decideAfterIdentifier({
      methods,
      settings,
      emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
    });
    const params = new URLSearchParams({ loginName });
    if (requestId) params.set('requestId', requestId);
    if (organization) params.set('organization', organization);
    return redirect(`${decision.target}?${params.toString()}`);
  }

  return { loginName, requestId, organization, methods: available };
}

export default function LoginMethod() {
  const { methods } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useRouteLoaderData('login') as LoginLayoutData;

  function buildParams(extra?: Record<string, string>): string {
    const p = new URLSearchParams({ loginName });
    if (requestId) p.set('requestId', requestId);
    if (organization) p.set('organization', organization);
    if (extra) Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  }

  return (
    <SplitLayout>
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-foreground text-2xl leading-6 font-semibold">
          <Trans>Choose how to sign in</Trans>
        </h1>
        <p className="text-foreground/80 text-sm">
          <Trans>Select your preferred sign-in method.</Trans>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {methods.includes('passkey') ? (
          <Button
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            asChild
            iconPosition="left"
            icon={<Icon icon={Key} />}>
            <Link to={`/login/passkey?${buildParams()}`}>
              <Trans>Passkey</Trans>
            </Link>
          </Button>
        ) : null}

        {methods.includes('otp_email') ? (
          <Button
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            asChild
            iconPosition="left"
            icon={<Icon icon={Mail} />}>
            <Link to={`/login/verify/email?${buildParams()}`}>
              <Trans>Email me a sign-in link</Trans>
            </Link>
          </Button>
        ) : null}

        {methods.includes('password') ? (
          <Button
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            asChild
            iconPosition="left"
            icon={<Icon icon={Lock} />}>
            <Link to={`/login/password?${buildParams()}`}>
              <Trans>Password</Trans>
            </Link>
          </Button>
        ) : null}

        {methods.includes('idp') ? (
          <Button
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            asChild
            iconPosition="left"
            icon={<Icon icon={UserCircle} />}>
            <Link to={`/sso?${buildParams()}`}>
              <Trans>Continue with your provider</Trans>
            </Link>
          </Button>
        ) : null}
      </div>
    </SplitLayout>
  );
}
