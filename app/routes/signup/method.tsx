import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { BackLink } from '@/components/back-link/back-link';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { MaxMindTracker, syncMaxMindTokenToRef } from '@/modules/fraud/maxmind-tracker';
import { genericCheckYourEmail } from '@/resources/schemas/check-your-email.schema';
import { resolveOrg } from '@/resources/shared/resolve-org';
import {
  passwordFirstHandoff,
  registerPasskeyFirst,
  registerEmailLinkSignup,
} from '@/resources/signup';
import { resolveSignupView } from '@/resources/signup/signup-view';
import { signupMethodSchema } from '@/resources/signup/signup.schema';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { requireEmailVerification } from '@/server/env';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { getOrCreateFingerprintId, userAgentFromRequest } from '@/server/user-agent';
import { actionError } from '@/utils/errors/auth-error';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { useRef } from 'react';
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Finish creating your account' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);

  const loginName = url.searchParams.get('loginName') ?? '';
  const firstName = url.searchParams.get('firstName') ?? '';
  const lastName = url.searchParams.get('lastName') ?? '';
  const organization = url.searchParams.get('organization') ?? undefined;
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const deviceTrackingToken = url.searchParams.get('deviceTrackingToken') ?? undefined;

  // Org-first: an explicit org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
  // The IdP list is a display read — like getLoginSettings it uses the default-org fallback,
  // not the raw URL org (which is undefined on a bare signup).
  const settingsOrg = await resolveOrg(provider, organization);
  const [settings, idps] = await Promise.all([
    provider.getLoginSettings(settingsOrg),
    provider.capabilities.externalIdp ? provider.getActiveIdPs(settingsOrg) : Promise.resolve([]),
  ]);
  const view = resolveSignupView(
    settings,
    idps,
    env.AUTH_EMAIL_DELIVERY_ENABLED,
    requireEmailVerification()
  );

  const { csrfToken, headers } = await loaderCsrf(request);

  return data(
    {
      csrfToken,
      loginName,
      firstName,
      lastName,
      organization,
      requestId,
      deviceTrackingToken,
      // Mounts MaxMindTracker below so a user who lingers on this intermediate screen (rather
      // than submitting straight through from /signup) still gets device.js's capture window —
      // previously this screen had no tracker mounted at all (see maxmind-tracker.tsx).
      maxmindAccountId: env.MAXMIND_ACCOUNT_ID ?? '',
      view,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = signupMethodSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { intent, loginName, firstName, lastName, organization, requestId, deviceTrackingToken } =
    parsed.data;

  // Enforce the org registration policy SERVER-SIDE. The loader hides disabled methods from the
  // view, but that is display-only — a direct POST (or a stale form) would otherwise bypass it and
  // register on an org that disallows registration (or the specific method). Re-read the policy for
  // the same org scope the loader used and reject disallowed methods before provisioning anything.
  const policy = await provider.getLoginSettings(await resolveOrg(provider, organization));
  const methodDisallowed =
    policy.allowRegister === false ||
    (intent === 'password' && !policy.allowPassword) ||
    (intent === 'passkey' && policy.passkeysType === 'not_allowed');
  if (methodDisallowed) {
    return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  }

  if (intent === 'email-link') {
    if (!env.AUTH_EMAIL_DELIVERY_ENABLED)
      return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
    try {
      const result = await registerEmailLinkSignup(provider, await readSessions(request), {
        email: loginName,
        firstName,
        lastName,
        organization,
        requestId,
        origin: trustedAppOrigin(request),
        deviceTrackingToken,
      });
      return genericCheckYourEmail(result.email);
    } catch (err) {
      return actionError(err);
    }
  }

  if (intent === 'passkey') {
    try {
      // Hoist session read so both the service call and the 'sent' fallback use the
      // same snapshot. Also ensure a fingerprintId cookie exists for this browser:
      // brand-new users arrive here without one, and the minted id must feed the
      // userAgent so the first session already carries a stable fingerprint.
      const sessions = await readSessions(request);
      const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request);
      const result = await registerPasskeyFirst(provider, sessions, {
        email: loginName,
        firstName,
        lastName,
        organization,
        requestId,
        deviceTrackingToken,
        userAgent: userAgentFromRequest(request, fingerprintId),
        // A passkey proves device possession, not email ownership. When verification is REQUIRED,
        // a brand-new email gets the 'sent-with-session' result below (→ "Check your email") and an
        // existing email returns the enumeration-safe 'sent', indistinguishable from a new one.
        // EMAIL_VERIFICATION is OFF by default (opt-in) — when off, this routes straight to
        // /setup/passkey via the 'redirect' branch, minting a FACTORLESS placeholder session that
        // only becomes an authenticated login once the WebAuthn ceremony completes (mirrors the old
        // auth-ui /passkey/set wizard: pre-ceremony session carries no verified factor).
        requireVerification: requireEmailVerification(),
        origin: trustedAppOrigin(request),
      });

      if (result.kind === 'sent') {
        // Enumeration defence (#16): emit a Set-Cookie on the duplicate-email path too so
        // the presence of Set-Cookie cannot distinguish a fresh address from an existing one.
        // We re-serialize the caller's unchanged session list (no new sessions were created).
        const headers = new Headers({ 'set-cookie': await serializeSessions(sessions) });
        if (fpCookie) headers.append('set-cookie', fpCookie);
        return data({ sent: true as const, email: result.email }, { status: 200, headers });
      }
      if (result.kind === 'sent-with-session') {
        const headers = new Headers({ 'set-cookie': await serializeSessions(result.sessions) });
        if (fpCookie) headers.append('set-cookie', fpCookie);
        return data({ sent: true as const, email: result.email }, { status: 200, headers });
      }
      // kind === 'redirect'
      const headers = new Headers({ 'set-cookie': await serializeSessions(result.sessions) });
      if (fpCookie) headers.append('set-cookie', fpCookie);
      return redirect(result.target, { headers });
    } catch (err) {
      return actionError(err);
    }
  }

  // intent === 'password'
  const result = passwordFirstHandoff({
    email: loginName,
    firstName,
    lastName,
    organization,
    requestId,
    deviceTrackingToken,
  });
  return redirect(result.target);
}

// ── Shared hidden fields carried in every method form ──────────────────────────
//
// csrf + loginName/organization/requestId come from the shared <AuthFormFields>
// cluster. firstName/lastName/deviceTrackingToken are method-specific extras carried
// alongside it (AuthFormFields owns only the canonical identity set).

interface HiddenContextProps {
  csrf: string;
  loginName: string;
  firstName: string;
  lastName: string;
  organization?: string;
  requestId?: string;
  deviceTrackingToken?: string;
  /**
   * Ref'd so the owning form's submit button can write a freshly-read MaxMind token into it at
   * click time (syncMaxMindTokenToRef) — see the per-intent Button `onClick` handlers below.
   * Each of the three forms on this screen renders its OWN HiddenContext instance, so each gets
   * its own ref; a single shared ref would only ever point at the last-mounted instance.
   */
  deviceTokenRef?: React.RefObject<HTMLInputElement | null>;
}

function HiddenContext({
  csrf,
  loginName,
  firstName,
  lastName,
  organization,
  requestId,
  deviceTrackingToken,
  deviceTokenRef,
}: HiddenContextProps) {
  return (
    <>
      <AuthFormFields
        csrf={csrf}
        loginName={loginName}
        requestId={requestId}
        organization={organization}
      />
      <input type="hidden" name="firstName" value={firstName} />
      <input type="hidden" name="lastName" value={lastName} />
      {/* Always rendered (unlike the old conditional): the submit-time sync needs a DOM node to
          write into even when no token arrived via the URL yet — an empty string round-trips
          identically to "absent" everywhere downstream (all deviceTrackingToken consumers use a
          truthy check), so this is not a behavior change for the no-token case. */}
      <input
        type="hidden"
        name="deviceTrackingToken"
        ref={deviceTokenRef}
        defaultValue={deviceTrackingToken ?? ''}
      />
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SignupMethod() {
  const {
    csrfToken,
    loginName,
    firstName,
    lastName,
    organization,
    requestId,
    deviceTrackingToken,
    maxmindAccountId,
    view,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== 'idle';

  // One ref per form — see the HiddenContextProps.deviceTokenRef doc comment above for why a
  // single shared ref would break with three independent forms on this screen.
  const emailLinkTokenRef = useRef<HTMLInputElement>(null);
  const passkeyTokenRef = useRef<HTMLInputElement>(null);
  const passwordTokenRef = useRef<HTMLInputElement>(null);

  // The action error surfaces INLINE through <AuthCeremony error> (this
  // replaces the per-route toast).
  const errorMessage = useAuthActionError(actionData);

  // Enumeration-safe terminal: the email-link path (and an existing-email passkey/IdP
  // attempt) returns a generic "check your email" — render it here, otherwise the screen
  // would silently re-render with no feedback.
  if (actionData && 'sent' in actionData) {
    return (
      <AuthCard
        title={<Trans>Check your email</Trans>}
        description={
          <Trans>
            We've sent a verification link to{' '}
            <strong>{(actionData as { email: string }).email}</strong>
          </Trans>
        }></AuthCard>
    );
  }

  const contextProps: HiddenContextProps = {
    csrf: csrfToken,
    loginName,
    firstName,
    lastName,
    organization,
    requestId,
    deviceTrackingToken,
  };

  return (
    <>
      {/* Mounted here too (in addition to /signup and /signup/password) so a user who lingers
          on this intermediate screen before choosing a method still gets device.js's capture
          window — see the loader comment above. */}
      <MaxMindTracker accountId={maxmindAccountId} />
      <AuthCeremony
        title={<Trans>Finish creating your account</Trans>}
        description={
          <Trans>
            You're almost done! <span className="font-medium">{loginName}</span>
          </Trans>
        }
        error={errorMessage}>
        <div className="flex w-full flex-col gap-3">
          {/* Email-link (passwordless) — always shown when email entry is allowed */}
          {view.showEmailLink ? (
            <RRForm method="post">
              <HiddenContext {...contextProps} deviceTokenRef={emailLinkTokenRef} />
              <input type="hidden" name="intent" value="email-link" />
              <Button
                size="large"
                className="h-13"
                type="quaternary"
                theme="outline"
                block
                htmlType="submit"
                loading={submitting && navigation.formData?.get('intent') === 'email-link'}
                onClick={() => syncMaxMindTokenToRef(emailLinkTokenRef)}>
                <Trans>Email me a sign-in link</Trans>
              </Button>
            </RRForm>
          ) : null}

          {/* Passkey */}
          {view.showPasskey ? (
            <RRForm method="post">
              <HiddenContext {...contextProps} deviceTokenRef={passkeyTokenRef} />
              <input type="hidden" name="intent" value="passkey" />
              <Button
                size="large"
                className="h-13"
                type="quaternary"
                theme="outline"
                block
                htmlType="submit"
                loading={submitting && navigation.formData?.get('intent') === 'passkey'}
                onClick={() => syncMaxMindTokenToRef(passkeyTokenRef)}>
                <Trans>Use a passkey</Trans>
              </Button>
            </RRForm>
          ) : null}

          {/* Password */}
          {view.showPassword ? (
            <RRForm method="post">
              <HiddenContext {...contextProps} deviceTokenRef={passwordTokenRef} />
              <input type="hidden" name="intent" value="password" />
              <Button
                size="large"
                className="h-13"
                type="quaternary"
                theme="outline"
                block
                htmlType="submit"
                loading={submitting && navigation.formData?.get('intent') === 'password'}
                onClick={() => syncMaxMindTokenToRef(passwordTokenRef)}>
                <Trans>Set a password</Trans>
              </Button>
            </RRForm>
          ) : null}
        </div>

        <BackLink />
      </AuthCeremony>
    </>
  );
}
