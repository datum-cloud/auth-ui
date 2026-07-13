import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { mostRecent, readSessions } from '@/modules/auth/session/cookie';
import {
  decisionOutcomeToResponse,
  deviceConsentErrorToResponse,
  loadDeviceConsent,
  resolveDeviceDecision,
} from '@/resources/device';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { Badge } from '@datum-cloud/datum-ui/badge';
import { Button, LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
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
import { Form as RRForm, Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Authorize device' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  // A CONTEXTLESS / missing user_code bare GET 302-redirects to /device's
  // code-entry screen (nothing to recover). A STALE / tampered code resolves to a spine AppError
  // tagged recovery: 'device' — returned as loader data (byte-frozen 404) so the route can render
  // the TAILORED "Code expired" recovery page below instead of falling through to the generic root
  // ErrorBoundary. Unexpected provider failures still throw and reach the ErrorBoundary.
  const outcome = await loadDeviceConsent(provider, request);
  if (outcome.kind === 'redirect') {
    return redirect(outcome.location);
  }
  if (outcome.kind === 'error') {
    return deviceConsentErrorToResponse(outcome.error);
  }

  const { csrfToken, headers } = await loaderCsrf(request);
  // The account that will authorize the grant is the most-recent session (resolveDeviceDecision
  // authorizes with mostRecent too) — surface it so the user can confirm or switch.
  const activeLoginName = mostRecent(await readSessions(request))?.loginName ?? null;

  return data({ csrfToken, activeLoginName, ...outcome.consent }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const outcome = await resolveDeviceDecision(provider, request, form);
  return decisionOutcomeToResponse(outcome);
}

export default function DeviceAuthorize() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  // Inline-only error surface for the deny/authorize ACTION error: it renders in a
  // <FormError> (role="alert") inside the consent form below — no toast. (The LOADER
  // missing/stale-code recovery is handled separately by the tailored card.)
  const errorMessage = useAuthActionError(actionData);

  // The loader returns a spine AppError tagged recovery: 'device' for the
  // missing / stale user_code paths. Render a TAILORED in-component recovery — mirroring
  // signup/complete's "Link expired" / "Start over" affordance — instead of the generic
  // root ErrorBoundary. The "Enter a new code" link sends the user back to /device's
  // code-entry screen (paths.device.index()).
  if ('error' in loaderData) {
    return (
      <AuthCard
        title={<Trans>Code expired</Trans>}
        description={<Trans>This device code is invalid or has expired.</Trans>}>
        <div className="flex flex-col gap-4 text-center">
          {/* LinkButton (single styled <a>) — NOT Button asChild, which emits
              <button><a> (nested-interactive axe violation in the prod build). */}
          <LinkButton theme="link" type="quaternary" block as={Link} href={paths.device.index()}>
            <Trans>Enter a new code</Trans>
          </LinkButton>
        </div>
      </AuthCard>
    );
  }

  // No `actionData.done` success branch: the action now REDIRECTS to the terminal
  // /device/complete screen on a successful decision (sidestepping RR7's post-action
  // revalidation of this route's getDeviceAuth loader). actionData only ever carries an
  // action ERROR here, surfaced inline via <FormError> below.
  const { csrfToken, appName, scope, deviceAuthId, requestId, activeLoginName } = loaderData;
  // requestId is `device_<userCode>`; thread the stable user code to /accounts so a
  // "change account" switch returns here to the consent screen with the newly-active account.
  const userCode = requestId.startsWith('device_') ? requestId.slice('device_'.length) : '';

  return (
    <AuthCard
      title={<Trans>Authorize device</Trans>}
      description={
        <>
          {appName ? (
            <Trans>
              <strong>{appName}</strong> is requesting access.
            </Trans>
          ) : (
            <Trans>Device authorization requested</Trans>
          )}
          {activeLoginName ? (
            <span className="mt-2 flex flex-wrap items-center justify-center gap-x-1.5">
              <span>
                <Trans>Authorizing as</Trans>{' '}
                <span className="text-foreground font-medium">{activeLoginName}</span>
              </span>
              <LinkButton
                theme="link"
                type="quaternary"
                className="h-auto p-0 text-sm"
                as={Link}
                href={paths.accounts({ user_code: userCode })}>
                <Trans>Use a different account</Trans>
              </LinkButton>
            </span>
          ) : (
            <span className="mt-2 block">
              <Trans>You'll be asked to sign in before authorizing.</Trans>
            </span>
          )}
        </>
      }>
      <div className="flex flex-col gap-4">
        {scope.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {scope.map((s) => (
              <Badge type="quaternary" key={s}>
                {s}
              </Badge>
            ))}
          </div>
        )}
        {activeLoginName ? (
          <RRForm method="post" className="flex w-full flex-col gap-4">
            <AuthFormFields csrf={csrfToken} />
            <input type="hidden" name="deviceAuthId" value={deviceAuthId} />
            <input type="hidden" name="requestId" value={requestId} />
            <FormError>{errorMessage}</FormError>
            <div className="flex flex-col gap-3">
              <Button
                htmlType="submit"
                name="decision"
                className="w-full"
                value="authorize"
                disabled={isSubmitting}>
                <Trans>Authorize</Trans>
              </Button>
              <Button
                htmlType="submit"
                name="decision"
                value="deny"
                type="secondary"
                theme="outline"
                className="w-full"
                disabled={isSubmitting}>
                <Trans>Deny</Trans>
              </Button>
            </div>
          </RRForm>
        ) : (
          // Not signed in: authorizing requires a session. Lead with a clear "Sign in to
          // continue" CTA (after login the device auto-completes — no second consent click)
          // instead of an Authorize button that silently bounces to /login. Deny still works
          // sessionlessly, so a user can reject an unrecognized device without signing in.
          <div className="flex w-full flex-col gap-3">
            <FormError>{errorMessage}</FormError>
            <LinkButton type="primary" block as={Link} href={paths.login.index({ requestId })}>
              <Trans>Sign in to continue</Trans>
            </LinkButton>
            <RRForm method="post">
              <AuthFormFields csrf={csrfToken} />
              <input type="hidden" name="deviceAuthId" value={deviceAuthId} />
              <input type="hidden" name="requestId" value={requestId} />
              <Button
                htmlType="submit"
                name="decision"
                value="deny"
                type="secondary"
                theme="outline"
                block
                disabled={isSubmitting}>
                <Trans>Deny</Trans>
              </Button>
            </RRForm>
          </div>
        )}
      </div>
    </AuthCard>
  );
}
