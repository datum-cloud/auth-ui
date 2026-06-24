import { useLoginContext } from '@/hooks/use-login-context';
import SplitLayout from '@/layouts/split.layout';
import { decideAfterIdentifier } from '@/resources/login/login-decision';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { env } from '@/server/infra/env.server';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans } from '@lingui/react/macro';
import { Key, Lock, Mail, UserCircle } from 'lucide-react';
import { redirect, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from 'react-router';
import { Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Choose how to sign in' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);

  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;

  if (!loginName)
    return redirect(paths.login.index(requestId ? { requestId, organization } : undefined));

  const user = await provider.findUser(loginName, organization);
  if (!user)
    return redirect(paths.login.index(requestId ? { requestId, organization } : undefined));

  // The method chooser is a branded screen — thread getBranding through so SplitLayout
  // renders the org logo, mirroring /login and /signup. Fetched in parallel with the rest.
  const [methods, settings, branding] = await Promise.all([
    provider.listAuthMethods(user.id),
    provider.getLoginSettings(organization),
    provider.getBranding(organization),
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
  // and redirect to the single target (or /error). Consume the Decision union by
  // `kind` — 'redirect' → its path, 'error' → /error.
  if (available.length < 2) {
    const decision = decideAfterIdentifier({
      methods,
      settings,
      emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
      context: { role: 'primary' }, // post-identifier decision is the primary flow
    });
    const params = new URLSearchParams({ loginName });
    if (requestId) params.set('requestId', requestId);
    if (organization) params.set('organization', organization);
    const target = decision.kind === 'redirect' ? decision.path : paths.error();
    return redirect(`${target}?${params.toString()}`);
  }

  return { loginName, requestId, organization, methods: available, branding };
}

export default function LoginMethod() {
  const { methods, branding } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useLoginContext();

  // Typed paths.* emit the identical query string buildParams produced
  // (loginName, then requestId, then organization — undefined values are skipped).
  const query = { loginName, requestId, organization };

  return (
    <SplitLayout branding={branding}>
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-foreground text-2xl leading-6 font-semibold">
          <Trans>Choose how to sign in</Trans>
        </h1>
        <p className="text-foreground/80 text-sm">
          <Trans>Select your preferred sign-in method.</Trans>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {/* LinkButton (single styled <a>) — NOT Button asChild, which emits
            <button><a> (nested-interactive axe violation in the prod build). */}
        {methods.includes('passkey') ? (
          <LinkButton
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            as={Link}
            href={paths.login.passkey(query)}
            iconPosition="left"
            icon={<Icon icon={Key} />}>
            <Trans>Passkey</Trans>
          </LinkButton>
        ) : null}

        {methods.includes('otp_email') ? (
          <LinkButton
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            as={Link}
            href={paths.login.verify.email(query)}
            iconPosition="left"
            icon={<Icon icon={Mail} />}>
            <Trans>Email me a sign-in link</Trans>
          </LinkButton>
        ) : null}

        {methods.includes('password') ? (
          <LinkButton
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            as={Link}
            href={paths.login.password(query)}
            iconPosition="left"
            icon={<Icon icon={Lock} />}>
            <Trans>Password</Trans>
          </LinkButton>
        ) : null}

        {methods.includes('idp') ? (
          <LinkButton
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            as={Link}
            href={paths.sso.index(query)}
            iconPosition="left"
            icon={<Icon icon={UserCircle} />}>
            <Trans>Continue with your provider</Trans>
          </LinkButton>
        ) : null}
      </div>
    </SplitLayout>
  );
}
