import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { IdpButtonList } from '@/components/auth-form/idp-button-list';
import { LastUsedBadge } from '@/components/auth-form/last-used-badge';
import { OrDivider } from '@/components/auth-form/or-divider';
import { FormError } from '@/components/form-error/form-error';
import { WebAuthnReasonCopy } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { useConditionalPasskey } from '@/hooks/use-conditional-passkey';
import { useLoginContext } from '@/hooks/use-login-context';
import { usePasskeyLoginCeremony } from '@/hooks/use-passkey-login-ceremony';
import SplitLayout from '@/layouts/split.layout';
import { idpTypeToSlug } from '@/modules/auth/idp-slug';
// ADAPTATION (plan-drift fix): readSessions + serializeSessions live in @/modules/auth/session/cookie.
// The locked plan block incorrectly listed them as coming from @/modules/auth/session/session
// (that module only has pure helpers, no cookie I/O).
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { clearIdpAutostart } from '@/modules/auth/session/idp-autostart';
import { readLastUsedLogin } from '@/modules/auth/session/last-used-login';
import { readPasskeyHint, clearPasskeyHint } from '@/modules/auth/session/passkey-hint';
import { readReauthIntent } from '@/modules/auth/session/reauth-intent';
import { shouldBridgeToAuthorize, startIdpIntent, resolveIdentifier } from '@/resources/login';
import { resolveLoginView, resolveIdentifierField } from '@/resources/login/login-view';
import {
  loginIdentifierSchema,
  loginIdpSchema,
  isPhoneLike,
  makeLoginIdentifierClientSchema,
} from '@/resources/login/login.schema';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { getActiveIdPs } from '@/resources/sso/idp-providers';
import { armLoginPasskey } from '@/resources/webauthn/arm-login-passkey';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { getOrCreateFingerprintId, userAgentFromRequest } from '@/server/user-agent';
import { Button } from '@datum-cloud/datum-ui/button';
import { Form } from '@datum-cloud/datum-ui/form';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { cn } from '@datum-cloud/datum-ui/utils';
import { Trans, useLingui } from '@lingui/react/macro';
import { Mail, UserKey } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  data,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm, Link, useLoaderData, useActionData, useNavigation } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Sign in' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);

  // Bridge raw login-v2 protocol entries (?authRequest=/?samlRequest=) to /authorize.
  // The post-identifier ?requestId= return never re-triggers this (no loop).
  if (shouldBridgeToAuthorize(url.searchParams)) {
    return redirect(`${paths.authorize()}${url.search}`);
  }

  // Org-first with a default-org fallback for DISPLAY reads only. An explicit `?organization=`
  // wins, else the env pin, else the provider's instance Default Organization. The resolved
  // `displayOrg` is used ONLY for branding/settings/IdP display reads on this request — it is
  // NEVER injected back into the URL and NEVER reaches findUser. The ceremony org (what downstream
  // screens and findUser receive) comes exclusively from the raw `?organization=` the user arrived
  // with, keeping instance-wide user lookup intact for users outside the default org.
  const rawOrg = url.searchParams.get('organization') ?? undefined; // explicit org (or undefined)
  const displayOrg = await resolveOrg(provider, rawOrg); // default-org fallback — display reads ONLY

  const [settings, branding, idps] = await Promise.all([
    provider.getLoginSettings(displayOrg),
    provider.getBranding(displayOrg),
    provider.capabilities.externalIdp ? provider.getActiveIdPs(displayOrg) : Promise.resolve([]),
  ]);
  // CSRF assembly + last-used read are independent (local cookie/crypto, no network) — run in parallel.
  const [{ csrfToken, headers }, lastUsedLogin] = await Promise.all([
    loaderCsrf(request),
    readLastUsedLogin(request),
  ]);
  const notice = url.searchParams.get('notice') ?? undefined;

  // ── Usernameless fast path: arm a conditional-mediation passkey ceremony ────
  // Two arms tried as a CASCADE (armLoginPasskey), not mutually-exclusive alternatives.
  // The first arm binds a pre-minted, user-bound challenge to the passkey hint — but only
  // when nothing more specific is known: it declines under ?add=1 (user asked for a
  // different account), a hinted user already live (nothing to log in), an unresolvable
  // user (the hint is cleared), or no passkey method. Every decline of the first arm falls
  // through to the second: usernameless identity discovery, which serves ?add=1 and a live
  // session just as well as a cold browser (gated only by the AUTH_PASSKEY_DISCOVERY_ENABLED
  // kill switch). Every failure of both arms — and every mint failure — renders the
  // ordinary page; arming is invisible either way.
  const responseHeaders = new Headers(headers);
  const hint = await readPasskeyHint(request);
  const arming = await armLoginPasskey(provider, request, {
    hint,
    isAddAccount: url.searchParams.get('add') === '1',
    sessions: await readSessions(request),
    hostname: url.hostname,
    discoveryEnabled: env.AUTH_PASSKEY_DISCOVERY_ENABLED,
  });
  for (const cookie of arming.setCookies) responseHeaders.append('set-cookie', cookie);
  if (arming.clearHint) responseHeaders.append('set-cookie', await clearPasskeyHint());
  const { conditionalPasskey, identityDiscovery } = arming;

  return data(
    {
      settings,
      branding,
      csrfToken,
      idps,
      emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
      notice,
      lastUsedLogin,
      conditionalPasskey,
      identityDiscovery,
    },
    { headers: responseHeaders }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  // /login is state-changing — verify CSRF before anything else.
  await assertCsrf(request, form);

  // IdP intent branch — must come before identifier logic.
  if (form.get('intent') === 'idp') {
    const parsed = loginIdpSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' }, { status: 400 });
    const { idpId, requestId, organization, deviceTrackingToken } = parsed.data;
    // RE-AUTH: when this login is re-authenticating a specific account, pass its loginName as a
    // best-effort login_hint so the IdP pre-selects it. The callback's identity check is the guard.
    const reauthHint = await readReauthIntent(request);
    // LDAP is not a redirect-based IdP: startIdpIntent returns no authUrl for it (→ IDP_UNAVAILABLE
    // 502). Resolve the IdP type server-side (same displayOrg scope the loader used to render the
    // buttons) and route LDAP submits to the /sso/ldap credential form, mirroring sso-action.ts.
    const displayIdps = await getActiveIdPs(provider, await resolveOrg(provider, organization));
    const targetIdp = displayIdps.find((i) => i.id === idpId);
    if (targetIdp && idpTypeToSlug(targetIdp.type) === 'ldap') {
      const qs = new URLSearchParams({ idpId });
      if (requestId) qs.set('requestId', requestId);
      if (organization) qs.set('organization', organization);
      return redirect(`/sso/ldap?${qs.toString()}`);
    }
    const result = await startIdpIntent(provider, {
      idpId,
      origin: trustedAppOrigin(request),
      requestId,
      organization,
      reauthHint: reauthHint ?? undefined,
      deviceTrackingToken,
    });
    if (!result.ok) return data({ error: result.error }, { status: 502 });
    // The authUrl is the provider's IdP-start URL; requestId + organization are threaded
    // via the IdP success URL (built inside the service), not here.
    return redirect(result.authUrl);
  }

  // Email-link branch — resolve the user + create the ceremony session, then redirect
  // to /login/verify/email which dispatches the OTP email on arrival.
  if (form.get('intent') === 'email-link') {
    if (!env.AUTH_EMAIL_DELIVERY_ENABLED) return data({ error: 'INVALID_INPUT' }, { status: 400 });
    const parsed = loginIdentifierSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' }, { status: 400 });
    const { loginName, requestId, organization } = parsed.data;
    const list = await readSessions(request);
    // Mint+persist the fingerprintId when absent and feed the SAME id into the
    // ceremony session's userAgent (no first-session gap). fpCookie is null when the
    // browser already carries the cookie (reuse).
    const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request);
    const result = await resolveIdentifier(provider, list, {
      loginName,
      requestId,
      organization,
      emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
      userAgent: userAgentFromRequest(request, fingerprintId),
    });
    if (!result.ok) {
      // EMAIL_LOGIN_DISABLED is a true client-input rejection (400). USER_NOT_FOUND is a
      // HANDLED, inline-rendered outcome — return it as normal action data with a 200 so the
      // RR single-fetch (/login.data?index) does NOT surface a 404 the browser console-errors
      // on. The inline <FormError> still renders from `data.error`.
      if (result.error === 'EMAIL_LOGIN_DISABLED') {
        return data({ error: result.error }, { status: 400 });
      }
      return data({ error: result.error });
    }
    const headers = new Headers();
    headers.append('set-cookie', await serializeSessions(result.sessions));
    if (fpCookie) headers.append('set-cookie', fpCookie);
    // Domain-discovery single-IdP org (org disallows password): start the IdP intent directly
    // rather than the email-link OTP flow, which the org policy doesn't support.
    if ('startIdp' in result) {
      const idpResult = await startIdpIntent(provider, {
        idpId: result.startIdp.idpId,
        origin: trustedAppOrigin(request),
        requestId: result.startIdp.requestId,
        organization: result.startIdp.organization,
        reauthHint: result.startIdp.loginName,
      });
      if (!idpResult.ok) return data({ error: idpResult.error }, { status: 502 });
      return redirect(idpResult.authUrl, { headers });
    }
    const verifyParams = new URLSearchParams(result.params);
    return redirect(`${paths.login.verify.email()}?${verifyParams.toString()}`, { headers });
  }

  // Identifier flow.
  const parsed = loginIdentifierSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' }, { status: 400 });
  const { loginName, requestId, organization } = parsed.data;

  // Strict phone rejection (server-side) when the org disables phone login. Org-first: an explicit
  // org wins (resolveOrg preserves it), else the default org — matching the old app's
  // `organization ?? getDefaultOrg()` on every settings read. This is a display/policy read, so the
  // default-org fallback is intentional here — unlike the user-lookup path, which stays explicit-only.
  const settings = await provider.getLoginSettings(await resolveOrg(provider, organization));
  if (resolveIdentifierField(settings).rejectPhone && isPhoneLike(loginName)) {
    return data({ error: 'PHONE_LOGIN_DISABLED' }, { status: 400 });
  }

  const list = await readSessions(request);
  // Mint+persist the fingerprintId when absent and feed the SAME id into the
  // ceremony session's userAgent (no first-session gap). fpCookie is null on reuse.
  const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request);
  const result = await resolveIdentifier(provider, list, {
    loginName,
    requestId,
    organization,
    emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
    userAgent: userAgentFromRequest(request, fingerprintId),
    // Thread the settings already fetched above (for the phone gate)
    // so resolveIdentifier skips its inner re-fetch on the known-user happy path.
    settings,
  });
  if (!result.ok) {
    // EMAIL_LOGIN_DISABLED is a true client-input rejection (400). USER_NOT_FOUND is a
    // HANDLED, inline-rendered outcome — return it as normal action data with a 200 so the
    // RR single-fetch (/login.data?index) does NOT surface a 404 the browser console-errors
    // on. The inline <FormError> still renders from `data.error`.
    if (result.error === 'EMAIL_LOGIN_DISABLED') {
      return data({ error: result.error }, { status: 400 });
    }
    return data({ error: result.error });
  }

  const headers = new Headers();
  headers.append('set-cookie', await serializeSessions(result.sessions));
  if (fpCookie) headers.append('set-cookie', fpCookie);
  // A fresh ceremony starts here, so retire any one-shot IdP auto-start marker the previous one
  // left behind — otherwise a sign-out/sign-in inside its 10-minute window suppressed the very
  // auto-start the marker exists to protect. Unconditional, and identical on both the known and
  // ghost branches: expiring an already-absent cookie is a no-op for the browser, and branching
  // on its presence would both cost a read and make the two branches' headers differ. See
  // clearIdpAutostart.
  headers.append('set-cookie', await clearIdpAutostart());
  // Domain-discovery single-IdP org: start the IdP intent directly. A plain redirect to /sso
  // (the old behavior) dead-ends session-less users in a /login ↔ /sso bounce loop.
  if ('startIdp' in result) {
    const idpResult = await startIdpIntent(provider, {
      idpId: result.startIdp.idpId,
      origin: trustedAppOrigin(request),
      requestId: result.startIdp.requestId,
      organization: result.startIdp.organization,
      reauthHint: result.startIdp.loginName,
    });
    if (!idpResult.ok) return data({ error: idpResult.error }, { status: 502 });
    return redirect(idpResult.authUrl, { headers });
  }
  // Every account with >= 1 usable method now resolves to the same target — /login/method —
  // which renders exactly what that account has and auto-starts what needs no form (a sole
  // linked IdP server-side in its loader, a sole passkey client-side on mount). This route
  // deliberately picks no per-method screen: it is pure over method KINDS, so it has no idpId
  // and could only ever name a static path (that is what sent sole-IdP users to a bare /sso).
  // The zero-method legs (/verify, /error) are unchanged.
  return redirect(`${result.target}?${result.params}`, { headers });
}

// Both in-place ceremonies on this page (the conditional fast path and the gated Passkey
// shortcut) submit assertions to /login/passkey while /login stays mounted. RR's default
// post-submit revalidation would re-run THIS loader, mint a fresh session + challenge for
// the hinted user, and rotate the armed ceremony's challenge out from under the just-signed
// assertion (WEBAU-3M9si class — same guard as /login/passkey:40 and /reauth:201). The
// ceremony hooks tag their submits with passkeyCeremony; anything else revalidates normally.
export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: {
  formData?: FormData;
  defaultShouldRevalidate: boolean;
}) {
  if (formData?.get('passkeyCeremony') === '1') return false;
  return defaultShouldRevalidate;
}

export default function Login() {
  const {
    csrfToken,
    idps,
    settings,
    branding,
    emailDeliveryEnabled,
    notice,
    lastUsedLogin,
    conditionalPasskey,
    identityDiscovery,
  } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useLoginContext();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  // The action error surfaces INLINE through <FormError> (this replaces the per-route
  // toast). /login renders in the visual harness, so this is the intended re-baseline
  // (toast → inline). AuthCeremony is NOT used here:
  // /login is the full SplitLayout welcome page (multi-method chooser), not an AuthCard
  // ceremony screen, so we mount the same inline FormError surface AuthCeremony owns.
  const errorMessage = useAuthActionError(actionData);

  // Identity the passkey ceremony binds to: the URL identifier, else the usernameless
  // hint the loader resolved. `||` (not `??`) because useLoginContext yields '' — not
  // undefined — when no identifier is threaded. Empty means NO resolvable identity:
  // Zitadel cannot mint a challenge for an unbound user, so the button must not start a
  // ceremony in that state (it would hang at 'loading-challenge' and disable the whole
  // chooser, which is why the old `&& loginName` gate existed).
  const passkeyIdentity = loginName || conditionalPasskey?.loginName || '';
  const ceremony = usePasskeyLoginCeremony({
    loginName: passkeyIdentity,
    requestId,
    organization,
  });
  // Usernameless fast path — armed by the loader for a hinted returning user (hinted
  // mode) or for a hintless fresh browser (discovery mode: identity tap → discover
  // round-trip → modal ceremony). Retired by the user's OWN form submission below
  // (no competing single-flight concern: the sole-passkey
  // path redirects to /login/passkey, so there is no competing in-place
  // ceremony on this page to race against).
  const conditional = useConditionalPasskey({
    // AMBIENT arming is hinted-only: a fresh-browser auto-prompt
    // is intrusive — password managers (1Password) escalate the quiet conditional
    // request into a full picker on page load. Discovery stays BUTTON-initiated
    // (beginDiscovery below); the loader-armed identityDiscovery options feed it.
    enabled: Boolean(conditionalPasskey),
    mode: conditionalPasskey ? 'hinted' : 'discovery',
    loginName: conditionalPasskey?.loginName ?? '',
    csrfToken,
    publicKeyCredentialRequestOptions:
      conditionalPasskey?.publicKeyCredentialRequestOptions ??
      identityDiscovery?.publicKeyCredentialRequestOptions ??
      null,
    requestId,
    organization,
  });
  const conditionalAbort = conditional.abort;
  // ANY form submission (identifier, email-link, IdP button) is the user stating explicit
  // intent — retire the armed conditional ceremony ("user types and
  // submits → abort()").
  useEffect(() => {
    if (navigation.state === 'submitting') conditionalAbort();
  }, [navigation.state, conditionalAbort]);
  const ceremonyBusy =
    ceremony.phase === 'loading-challenge' ||
    ceremony.phase === 'ceremony' ||
    ceremony.phase === 'submitting' ||
    // Button-initiated modal discovery in flight (picker open / discover round-trip).
    conditional.phase === 'submitting';
  // Server-side ceremony rejection (e.g. INVALID_CREDENTIALS on an expired/replayed
  // challenge) lands in ceremony.actionData, NOT ceremony.reason (that's browser-side
  // ceremony failures only — cancel, unsupported, security). Mirrors login/method.tsx's
  // identical serverError wiring so the gated Passkey shortcut reports ceremony failures
  // the same way.
  const ceremonyServerError = useAuthActionError(ceremony.actionData);

  const view = resolveLoginView(settings, idps, emailDeliveryEnabled);

  const field = resolveIdentifierField(settings);
  const identifierLabel = field.allowEmail
    ? field.allowPhone
      ? t`Email, phone, or username`
      : t`Email`
    : field.allowPhone
      ? t`Phone`
      : t`Username`;
  const identifierPlaceholder = field.allowEmail
    ? 'email@example.com'
    : field.allowPhone
      ? '+1 555 000 0000'
      : 'username';
  // Derived separately from identifierLabel: the field label spells out every accepted type
  // ("Email, phone, or username"), too long for a button. Email wins the both-allowed case —
  // it is the dominant identifier and the field states the full set once opened. Short noun
  // labels: the chooser reads as a method list — "Passkey",
  // "Google", "Email" — not as instructions. Separate `t` literals so Lingui extracts each.
  const identifierButtonLabel = field.allowEmail
    ? t`Email`
    : field.allowPhone
      ? t`Phone`
      : t`Username`;
  const identifierClientSchema = makeLoginIdentifierClientSchema({
    rejectPhone: field.rejectPhone,
  });

  const submittingIdpId =
    navigation.state !== 'idle' && navigation.formData?.get('intent') === 'idp'
      ? String(navigation.formData.get('idpId') ?? '')
      : null;
  const identifierSubmitting =
    navigation.state === 'submitting' && navigation.formData?.get('intent') !== 'idp';

  // Typed paths.* emit the identical query string the hand-built URLSearchParams
  // produced (insertion order requestId → organization; undefined values skipped).
  const signupHref = paths.signup.index({ requestId, organization });

  const [showEmailField, setShowEmailField] = useState(false);

  return (
    <SplitLayout branding={branding}>
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-foreground text-2xl leading-6 font-semibold">
          <Trans>Welcome</Trans>
        </h1>
        <p className="text-foreground/80 text-sm">
          <Trans>Choose your login method</Trans>
        </p>
        {notice === 'link-existing' ? (
          <p role="status" className="text-destructive mb-4 text-sm">
            <Trans>An account with this email already exists — sign in to continue.</Trans>
          </p>
        ) : null}
        {/* Inline action-error surface (role="alert" + aria-live) — replaces the
            per-route toast. Renders nothing when there is no error. */}
        <FormError>{errorMessage}</FormError>
      </div>

      {/* Shared ceremony-error surface — surfaces a FAILURE from the gated Passkey
          shortcut below (both drive the same `ceremony`). */}
      {ceremony.reason ? (
        <FormError>
          <WebAuthnReasonCopy reason={ceremony.reason} />
        </FormError>
      ) : conditional.reason ? (
        // Button-initiated modal discovery failure (cancel / no usable passkey) —
        // the user explicitly acted, so this is a message, not a non-event.
        <FormError>
          <WebAuthnReasonCopy reason={conditional.reason} />
        </FormError>
      ) : ceremonyServerError ? (
        <FormError>{ceremonyServerError}</FormError>
      ) : null}

      <>
        {view.showIdpButtons ? (
          <IdpButtonList
            idps={idps}
            csrf={csrfToken}
            requestId={requestId}
            organization={organization}
            submittingIdpId={submittingIdpId}
            relative
            lastUsedLogin={lastUsedLogin}
            disabled={ceremonyBusy}
          />
        ) : null}

        {view.showPasskeyPrompt ? (
          <Button
            size="large"
            className={cn('relative h-13 gap-3', view.showIdpButtons && 'mt-3')}
            type="quaternary"
            theme="outline"
            block
            htmlType="button"
            loading={ceremonyBusy}
            onClick={() => {
              // No resolvable identity — run the discovery ceremony MODALLY: the browser's native picker over the loader's
              // self-minted challenge, then the discover → verify pipeline. Fall back to
              // the identifier step only when discovery can't start — the
              // AUTH_PASSKEY_DISCOVERY_ENABLED kill switch is off, or WebAuthn is
              // unsupported (?add=1 and a live session no longer suppress discovery; the
              // loader's cascade arms it for both).
              if (!passkeyIdentity) {
                if (!conditional.beginDiscovery()) setShowEmailField(true);
                return;
              }
              conditionalAbort();
              ceremony.begin();
            }}
            iconPosition="left"
            icon={<Icon icon={UserKey} />}>
            <Trans>Passkey</Trans>
            <LastUsedBadge active={lastUsedLogin === 'passkey'} />
          </Button>
        ) : null}

        {view.showIdentifierForm && view.showIdpButtons ? <OrDivider /> : null}

        {view.showIdentifierForm ? (
          <>
            {!showEmailField ? (
              <Button
                size="large"
                className="relative h-13 gap-3"
                type="quaternary"
                theme="outline"
                block
                disabled={ceremonyBusy}
                iconPosition="left"
                icon={<Icon icon={Mail} />}
                onClick={() => setShowEmailField(true)}>
                {identifierButtonLabel}
                <LastUsedBadge active={lastUsedLogin === 'email'} />
              </Button>
            ) : (
              <Form.Root
                schema={identifierClientSchema}
                formComponent={RRForm}
                method="POST"
                defaultValues={{ loginName: loginName ?? '' }}
                isSubmitting={navigation.state === 'submitting'}
                className="flex w-full flex-col gap-4">
                <AuthFormFields
                  csrf={csrfToken}
                  requestId={requestId}
                  organization={organization}
                />
                <Form.Field
                  name="loginName"
                  label={identifierLabel}
                  required
                  labelClassName="text-xs"
                  className="mb-0">
                  {/* `username webauthn` (not plain `username`): the webauthn token is the
                      conditional-mediation autofill anchor — the browser attaches the
                      passkey suggestion to this field (usernameless discovery spec). */}
                  <Form.Input
                    type="text"
                    autoFocus
                    autoComplete="username webauthn"
                    placeholder={identifierPlaceholder}
                    className="h-9"
                  />
                </Form.Field>
                {/* Continue hands off to decideAfterIdentifier. With neither password nor
                    passkey that resolves to NO_SUPPORTED_METHOD, so it is hidden rather than
                    left to dead-end. Dropping it also makes the email-link button the first
                    submit button, so Enter in the field triggers email-link. */}
                {view.showContinue ? (
                  <SubmitButton loading={identifierSubmitting} disabled={ceremonyBusy}>
                    <Trans>Continue</Trans>
                  </SubmitButton>
                ) : null}
                {view.showEmailLink ? (
                  view.showContinue ? (
                    <button
                      type="submit"
                      name="intent"
                      value="email-link"
                      className="text-foreground/70 hover:text-foreground mt-1 w-full text-center text-sm underline underline-offset-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={navigation.state !== 'idle' || ceremonyBusy}>
                      <Trans>Email me a sign-in link</Trans>
                    </button>
                  ) : (
                    // Sole action — render as the primary button, not a secondary link. The
                    // intent rides on a hidden field rather than the button's name/value:
                    // SubmitButton does not forward those, and with no Continue button this
                    // form has exactly one submission meaning anyway.
                    <>
                      <input type="hidden" name="intent" value="email-link" />
                      <SubmitButton loading={identifierSubmitting} disabled={ceremonyBusy}>
                        <Trans>Email me a sign-in link</Trans>
                      </SubmitButton>
                    </>
                  )
                ) : null}
              </Form.Root>
            )}
          </>
        ) : null}

        {view.signInUnavailable ? (
          <p className="text-foreground text-center text-sm">
            <Trans>
              Sign-in is currently unavailable for this account. Please contact your administrator.
            </Trans>
          </p>
        ) : null}

        {view.showRegisterLink ? (
          <>
            <div className="border-border my-8 flex-grow border-t" />
            <p className="text-foreground/80 text-center text-sm">
              <Trans>Not registered?</Trans>{' '}
              <Link to={signupHref} className="underline">
                <Trans>Create account</Trans>
              </Link>
            </p>
          </>
        ) : null}
      </>
    </SplitLayout>
  );
}
