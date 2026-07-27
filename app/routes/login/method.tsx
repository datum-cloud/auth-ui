import { FormError } from '@/components/form-error/form-error';
import { IdpIcon } from '@/components/idp-icon/idp-icon';
import { WebAuthnReasonCopy } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { useLoginContext } from '@/hooks/use-login-context';
import { usePasskeyLoginCeremony } from '@/hooks/use-passkey-login-ceremony';
import SplitLayout from '@/layouts/split.layout';
import { decideAfterIdentifier } from '@/resources/login/login-decision';
import { readCeremonyParams } from '@/resources/shared/ceremony-params';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { joinLinkedIdps } from '@/resources/sso';
import { getActiveIdPs } from '@/resources/sso/idp-providers';
import type { LinkedIdpView } from '@/resources/sso/sso-management';
import { redirectToLogin } from '@/routes/login-bounce';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { env } from '@/server/infra/env.server';
import { Button, LinkButton } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { cn } from '@datum-cloud/datum-ui/utils';
import { Trans } from '@lingui/react/macro';
import { Key, Lock, Mail } from 'lucide-react';
import { redirect, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from 'react-router';
import { Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Choose how to sign in' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const { loginName, requestId, organization } = readCeremonyParams(new URL(request.url));

  if (!loginName) return redirect(redirectToLogin(requestId, organization));

  const user = await provider.findUser(loginName, organization);
  if (!user) return redirect(redirectToLogin(requestId, organization));

  // The method chooser is a branded screen — thread getBranding through so SplitLayout
  // renders the org logo, mirroring /login and /signup. Fetched in parallel with the rest.
  // Org-first: an explicit org wins, else the default org (matches the old app's
  // `organization ?? getDefaultOrg()`). findUser above stays instance-wide by design.
  const settingsOrg = await resolveOrg(provider, organization);
  const [methods, settings, branding] = await Promise.all([
    provider.listAuthMethods(user.id),
    provider.getLoginSettings(settingsOrg),
    provider.getBranding(settingsOrg),
  ]);

  // Compute available primary sign-in methods using the same policy gates as
  // decideAfterIdentifier (login-decision.ts). This screen only appears when
  // available.length >= 2; we surface exactly those available methods.
  const available: Array<'passkey' | 'password' | 'otp_email' | 'idp'> = [];
  if (methods.includes('passkey') && settings.passkeysType !== 'not_allowed')
    available.push('passkey');

  // Resolve the user's linked (redirect-based) IdPs for real icon/name rendering —
  // mirrors reauth.service.ts's loadReauth idp-resolution exactly, including the LDAP
  // exclusion (LDAP needs its own credential form, not an OAuth round-trip).
  let linkedIdps: LinkedIdpView[] = [];
  if (methods.includes('idp') && settings.allowExternalIdp) {
    const [links, active] = await Promise.all([
      provider.listIdpLinks(user.id),
      getActiveIdPs(provider, settingsOrg),
    ]);
    linkedIdps = joinLinkedIdps(links, active).filter((l) => l.type !== 'LDAP');
    if (linkedIdps.length > 0) available.push('idp');
  }

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

  return { loginName, requestId, organization, methods: available, branding, linkedIdps };
}

export default function LoginMethod() {
  const { methods, branding, linkedIdps } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useLoginContext();

  // Typed paths.* emit the identical query string buildParams produced
  // (loginName, then requestId, then organization — undefined values are skipped).
  const query = { loginName, requestId, organization };

  const ceremony = usePasskeyLoginCeremony({ loginName, requestId, organization });
  const serverError = useAuthActionError(ceremony.actionData);
  const passkeyBusy = ceremony.phase !== 'idle';

  return (
    <SplitLayout branding={branding}>
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-foreground text-2xl leading-6 font-semibold">
          <Trans>Choose how to sign in</Trans>
        </h1>
        <p className="text-foreground/80 text-sm">
          <Trans>
            Signing in as <span className="font-medium">{loginName}</span>.
          </Trans>{' '}
          <Link
            to={paths.login.index({ requestId, organization })}
            className="text-foreground underline underline-offset-4">
            <Trans>Not you?</Trans>
          </Link>
        </p>
        {ceremony.reason ? (
          <FormError>
            <WebAuthnReasonCopy reason={ceremony.reason} />
          </FormError>
        ) : serverError ? (
          <FormError>{serverError}</FormError>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {methods.includes('passkey') ? (
          // Button (not LinkButton) — fires the ceremony IN PLACE (lazy challenge;
          // a password pick never spends a session) instead of navigating to
          // /login/passkey. The list stays visible as the fallback on failure.
          <Button
            size="large"
            className="h-13 gap-3"
            type="quaternary"
            theme="outline"
            block
            htmlType="button"
            loading={passkeyBusy}
            onClick={() => ceremony.begin()}
            iconPosition="left"
            icon={<Icon icon={Key} />}>
            <Trans>Passkey</Trans>
          </Button>
        ) : null}

        {methods.includes('otp_email') ? (
          <LinkButton
            size="large"
            className={cn('h-13 gap-3', passkeyBusy && 'pointer-events-none opacity-50')}
            type="quaternary"
            theme="outline"
            block
            as={Link}
            href={paths.login.verify.email(query)}
            aria-disabled={passkeyBusy}
            onClick={(e) => passkeyBusy && e.preventDefault()}
            iconPosition="left"
            icon={<Icon icon={Mail} />}>
            <Trans>Email me a sign-in link</Trans>
          </LinkButton>
        ) : null}

        {methods.includes('password') ? (
          <LinkButton
            size="large"
            className={cn('h-13 gap-3', passkeyBusy && 'pointer-events-none opacity-50')}
            type="quaternary"
            theme="outline"
            block
            as={Link}
            href={paths.login.password(query)}
            aria-disabled={passkeyBusy}
            onClick={(e) => passkeyBusy && e.preventDefault()}
            iconPosition="left"
            icon={<Icon icon={Lock} />}>
            <Trans>Password</Trans>
          </LinkButton>
        ) : null}

        {methods.includes('idp')
          ? linkedIdps.map((idp) => (
              <LinkButton
                key={idp.idpId}
                size="large"
                className={cn('h-13 gap-3', passkeyBusy && 'pointer-events-none opacity-50')}
                type="quaternary"
                theme="outline"
                block
                as={Link}
                href={paths.sso.index(query)}
                aria-disabled={passkeyBusy}
                onClick={(e) => passkeyBusy && e.preventDefault()}
                iconPosition="left"
                icon={<IdpIcon type={idp.type} logoUrl={idp.logoUrl} />}>
                <Trans>Continue with {idp.name ?? idp.idpId}</Trans>
              </LinkButton>
            ))
          : null}
      </div>
    </SplitLayout>
  );
}
