import { AuthCard } from '@/components/auth-card/auth-card';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import {
  decisionOutcomeToResponse,
  loadDeviceConsent,
  resolveDeviceDecision,
} from '@/resources/device';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans, useLingui } from '@lingui/react/macro';
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

export const meta: MetaFunction = () => [{ title: 'Authorize device' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  // throws data(400|404) for the missing / stale user_code paths
  const consent = await loadDeviceConsent(provider, request);

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data({ csrfToken, ...consent }, { headers });
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
  const { t } = useLingui();
  const isSubmitting = navigation.state === 'submitting';

  const getErrorMessage = useAuthErrorMessage();
  useActionErrorToast(getErrorMessage((actionData as { error?: string } | undefined)?.error));

  if (actionData && 'done' in actionData) {
    return (
      <AuthCard
        title={<Trans>Authorization complete</Trans>}
        description={<Trans>You may return to your device.</Trans>}
      />
    );
  }

  const { csrfToken, appName, scope, deviceAuthId, requestId } = loaderData;

  return (
    <AuthCard title={<Trans>Authorize device</Trans>}>
      {appName && (
        <p>
          <Trans>
            <strong>{appName}</strong> is requesting access.
          </Trans>
        </p>
      )}
      {scope.length > 0 && (
        <ul aria-label={t`Requested permissions`}>
          {scope.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      <RRForm method="post" className="flex w-full flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="deviceAuthId" value={deviceAuthId} />
        <input type="hidden" name="requestId" value={requestId} />
        <div className="flex gap-2">
          <Button htmlType="submit" name="decision" value="authorize" disabled={isSubmitting}>
            <Trans>Authorize</Trans>
          </Button>
          <Button
            htmlType="submit"
            name="decision"
            value="deny"
            type="secondary"
            theme="outline"
            disabled={isSubmitting}>
            <Trans>Deny</Trans>
          </Button>
        </div>
      </RRForm>
    </AuthCard>
  );
}
