import { IdpButtonList } from '@/components/auth-form/idp-button-list';
import { FormError } from '@/components/form-error/form-error';
import { WebAuthnReasonCopy } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { useLoginContext } from '@/hooks/use-login-context';
import { usePasskeyLoginCeremony } from '@/hooks/use-passkey-login-ceremony';
import SplitLayout from '@/layouts/split.layout';
import type { IdProvider } from '@/modules/auth/types';
import { startIdpIntent } from '@/resources/login';
import { decideAfterIdentifier } from '@/resources/login/login-decision';
import { loginIdpSchema } from '@/resources/login/login.schema';
import { readCeremonyParams } from '@/resources/shared/ceremony-params';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { joinLinkedIdps } from '@/resources/sso';
import { getActiveIdPs } from '@/resources/sso/idp-providers';
import type { LinkedIdpView } from '@/resources/sso/sso-management';
import { redirectToLogin } from '@/routes/login-bounce';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { Button, LinkButton } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { cn } from '@datum-cloud/datum-ui/utils';
import { Trans } from '@lingui/react/macro';
import { Key, Lock, Mail } from 'lucide-react';
import {
  data,
  redirect,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
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
  const [methods, settings, branding, { csrfToken, headers }] = await Promise.all([
    provider.listAuthMethods(user.id),
    provider.getLoginSettings(settingsOrg),
    provider.getBranding(settingsOrg),
    loaderCsrf(request),
  ]);

  // Compute available primary sign-in methods using the same policy gates as
  // decideAfterIdentifier (login-decision.ts). This screen only appears when
  // available.length >= 2; we surface exactly those available methods.
  const available: Array<'passkey' | 'password' | 'otp_email' | 'idp'> = [];
  if (methods.includes('passkey') && settings.passkeysType !== 'not_allowed')
    available.push('passkey');

  // Resolve the user's linked (redirect-based) IdPs directly into IdpButtonList's
  // IdProvider shape — mirrors reauth.service.ts's loadReauth idp-resolution, including
  // the LDAP exclusion (LDAP needs its own credential form, not an OAuth round-trip). A
  // link whose provider is no longer active has no name/type to join — filtered out,
  // since there's no sign-in button to offer for a dead provider.
  let idps: IdProvider[] = [];
  if (methods.includes('idp') && settings.allowExternalIdp) {
    const [links, active] = await Promise.all([
      provider.listIdpLinks(user.id),
      getActiveIdPs(provider, settingsOrg),
    ]);
    idps = joinLinkedIdps(links, active)
      .filter(
        (l): l is LinkedIdpView & { name: string; type: string } =>
          l.name !== undefined && l.type !== undefined && l.type !== 'LDAP'
      )
      .map((l) => ({ id: l.idpId, name: l.name, type: l.type, logoUrl: l.logoUrl }));
    if (idps.length > 0) available.push('idp');
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

  return data(
    { loginName, requestId, organization, methods: available, branding, idps, csrfToken },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = loginIdpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  const { idpId, requestId, organization } = parsed.data;

  const { loginName } = readCeremonyParams(new URL(request.url));
  if (!loginName) return redirect(redirectToLogin(requestId, organization));

  const user = await provider.findUser(loginName, organization);
  // This action is unauthenticated (driven by the loginName ceremony param, not a session).
  // "Unknown user" and "known user, idp not linked" must return the IDENTICAL response —
  // previously the former redirected to /login while the latter returned this 400, making the
  // action a linked-IdP identity oracle (redirect vs 400 vs the eventual 302-to-provider on
  // success let an attacker probe both account existence and which IdP a given address uses).
  if (!user) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  // Defensive server-side re-check: never trust the client's idpId — confirm it
  // resolves to one of THIS identified user's own linked, active, non-LDAP providers
  // before starting the round-trip. Mirrors the same check reauth.tsx's idp-reauth
  // action uses for its own linked-IdP chooser.
  const settingsOrg = await resolveOrg(provider, organization);
  const [links, active] = await Promise.all([
    provider.listIdpLinks(user.id),
    getActiveIdPs(provider, settingsOrg),
  ]);
  const isLinked = joinLinkedIdps(links, active).some(
    (l) => l.idpId === idpId && l.type !== 'LDAP'
  );
  if (!isLinked) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const result = await startIdpIntent(provider, {
    idpId,
    origin: trustedAppOrigin(request),
    requestId,
    organization,
    reauthHint: loginName,
  });
  if (!result.ok) return data({ error: result.error }, { status: 502 });
  return redirect(result.authUrl);
}

export default function LoginMethod() {
  const { methods, branding, idps, csrfToken } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useLoginContext();

  // Typed paths.* emit the identical query string buildParams produced
  // (loginName, then requestId, then organization — undefined values are skipped).
  const query = { loginName, requestId, organization };

  const ceremony = usePasskeyLoginCeremony({ loginName, requestId, organization });
  const serverError = useAuthActionError(ceremony.actionData);
  const passkeyBusy = ceremony.phase !== 'idle';

  // Mirrors login/index.tsx's own submittingIdpId computation — drives IdpButtonList's
  // per-row loading state while its POST to this route's own action is in flight.
  const navigation = useNavigation();
  const submittingIdpId =
    navigation.state !== 'idle' && navigation.formData?.get('intent') === 'idp'
      ? String(navigation.formData.get('idpId') ?? '')
      : null;

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

        {methods.includes('idp') ? (
          <IdpButtonList
            idps={idps}
            csrf={csrfToken}
            requestId={requestId}
            organization={organization}
            submittingIdpId={submittingIdpId}
            disabled={passkeyBusy}
          />
        ) : null}
      </div>
    </SplitLayout>
  );
}
