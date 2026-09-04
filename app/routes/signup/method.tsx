import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { MaxMindTracker, syncMaxMindTokenToRef } from '@/modules/fraud/maxmind-tracker';
import { genericCheckYourEmail } from '@/resources/schemas/check-your-email.schema';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { registerPasskeySignup } from '@/resources/signup/passkey-signup';
import { resolveSignupView } from '@/resources/signup/signup-view';
import { signupMethodSchema } from '@/resources/signup/signup.schema';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { requireEmailVerification } from '@/server/env';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { actionError } from '@/utils/errors/auth-error';
import { Button } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans } from '@lingui/react/macro';
import { Key } from 'lucide-react';
import { useRef } from 'react';
import {
  data,
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

  const { loginName, firstName, lastName, organization, requestId } = parsed.data;

  // Both signup routes share ONE register path (policy gate → delivery gate → register), so a
  // tightened check cannot apply to one and miss the other. See resources/signup/passkey-signup.ts.
  //
  // This screen was previously reachable under two intents ('passkey' and 'email-link') running
  // byte-identical bodies — two buttons, one behavior. It is passkey-only now and the schema
  // rejects any other intent, so there is one register path and one response shape.
  try {
    const result = await registerPasskeySignup(provider, {
      email: loginName,
      firstName,
      lastName,
      organization,
      requestId,
      origin: trustedAppOrigin(request),
    });
    if (!result) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
    return genericCheckYourEmail(result.email);
  } catch (err) {
    return actionError(err);
  }
}

// ── Shared hidden fields carried in the method form ────────────────────────────
//
// csrf + loginName/organization/requestId come from the shared <AuthFormFields>
// cluster. firstName/lastName/deviceTrackingToken are signup-specific extras carried
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
   * click time (syncMaxMindTokenToRef) — see the Button `onClick` handler below. Kept per-form
   * rather than module-level: if this screen ever regains a second method form, a single shared
   * ref would silently point at whichever instance mounted last.
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

  // One ref for the single form on this screen (see HiddenContextProps.deviceTokenRef).
  const passkeyTokenRef = useRef<HTMLInputElement>(null);

  // The action error surfaces INLINE through <AuthCeremony error> (this
  // replaces the per-route toast).
  const errorMessage = useAuthActionError(actionData);

  // "Not you?" returns to the signup start (mirrors signup/password.tsx one step later).
  const notYouHref = paths.signup.index({ requestId, organization });

  // Enumeration-safe terminal: registering (including when the address already exists)
  // returns a generic "check your email" — render it here, otherwise the screen would
  // silently re-render with no feedback.
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
          <IdentityBadge
            loginName={loginName}
            verb={<Trans>Signing up as</Trans>}
            linkTarget={notYouHref}
          />
        }
        error={errorMessage}>
        <div className="flex w-full flex-col gap-3">
          {/* Passkey is the ONLY signup credential. The "Email me a sign-in link" button that
              used to sit above this posted a different intent through a byte-identical action
              branch — the same verification mail, the same landing page — so it was a second
              control for this exact flow rather than an alternative to it. "Set a password" is
              gone with it: signup is passwordless.

              Styled to match the /login/method chooser (h-13, gap-3, leading Icon) so the
              signup and sign-in method screens read as one family. It stays a POSTing <Form>
              rather than the chooser's <LinkButton> — this submits an intent with CSRF and the
              carried identity fields, it does not navigate. */}
          {view.showPasskey ? (
            <RRForm method="post">
              <HiddenContext {...contextProps} deviceTokenRef={passkeyTokenRef} />
              <input type="hidden" name="intent" value="passkey" />
              <Button
                size="large"
                className="h-13 gap-3"
                type="quaternary"
                theme="outline"
                block
                iconPosition="left"
                icon={<Icon icon={Key} />}
                htmlType="submit"
                loading={submitting}
                onClick={() => syncMaxMindTokenToRef(passkeyTokenRef)}>
                <Trans>Use a passkey</Trans>
              </Button>
            </RRForm>
          ) : (
            /* Policy (or missing mail delivery) leaves no way to finish signing up. Say so
               plainly instead of rendering an empty card the user can only back out of. */
            <FormError>
              <Trans>
                Signing up isn't available right now. Please try again later or contact support.
              </Trans>
            </FormError>
          )}
        </div>
      </AuthCeremony>
    </>
  );
}
