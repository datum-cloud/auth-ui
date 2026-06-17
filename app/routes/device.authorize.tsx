import { AuthCard } from '@/components/auth-card';
import { deviceDecision } from '@/flows/device-decision';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent, hashActor } from '@/server/observability';
import { readSessions, mostRecent } from '@/session/cookie';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans, useLingui } from '@lingui/react/macro';
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
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Authorize device' }];

const decisionSchema = z.object({
  decision: z.enum(['authorize', 'deny']),
  deviceAuthId: z.string().min(1),
  requestId: z.string().regex(/^device_/),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);
  const userCode = url.searchParams.get('user_code');
  if (!userCode) {
    throw data('missing user_code', { status: 400 });
  }

  let req;
  try {
    req = await provider.getDeviceAuth(userCode);
  } catch (error) {
    // stale deep-link / tampered user_code — friendly 404 instead of a raw error boundary
    if (error instanceof ProviderError && error.code === 'NOT_FOUND') {
      throw data('device_auth_not_found', { status: 404 });
    }
    throw error;
  }

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data(
    {
      csrfToken,
      appName: req.appName ?? '',
      scope: req.scope,
      deviceAuthId: req.id,
      // STABLE user code, not req.id: the Zitadel adapter returns a different opaque
      // id per getDeviceAuth call. When the unauthenticated-consent path bounces
      // through /login, the ceremony threads this requestId back to /authorize, which
      // re-derives ?user_code= for this screen (post-login return-to-consent).
      requestId: `device_${userCode}`,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = decisionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    logAuthEvent('device_authorize', 'failure', { reason: 'invalid_input' });
    return data({ error: 'invalid_input' as const }, { status: 400 });
  }

  const { decision, deviceAuthId, requestId } = parsed.data;

  const sessions = await readSessions(request);
  const entry = mostRecent(sessions);

  // Only authorize requires a signed-in session. Sessionless deny is deliberate:
  // denial is fail-safe (revokes, never grants) and mirrors the fork's RFC 8628
  // consent semantics — a user who refuses to sign in can still reject the device.
  if (decision === 'authorize' && !entry) {
    return redirect(`/login?requestId=${encodeURIComponent(requestId)}`);
  }

  try {
    await provider.authorizeDevice(
      deviceAuthId,
      deviceDecision({
        decision,
        session: entry ? { id: entry.id, token: entry.token } : undefined,
      })
    );
  } catch (error) {
    // stale deviceAuthId / provider outage — audit + render a displayable error
    if (error instanceof ProviderError) {
      logAuthEvent('device_authorize', 'failure', {
        decision,
        deviceAuthId,
        requestId,
        reason: error.code,
      });
      return data({ error: 'provider_error' as const }, { status: 502 });
    }
    throw error;
  }

  logAuthEvent('device_authorize', 'success', {
    decision,
    deviceAuthId,
    requestId,
    actor: entry?.loginName ? hashActor(entry.loginName) : undefined,
  });

  return data({ done: decision });
}

export default function DeviceAuthorize() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();
  const isSubmitting = navigation.state === 'submitting';

  if (actionData && 'done' in actionData) {
    return (
      <AuthCard title={<Trans>Authorization complete</Trans>}>
        {/* role="status": polite live-region so AT announces the in-page state swap */}
        <p role="status">
          <Trans>You may return to your device.</Trans>
        </p>
      </AuthCard>
    );
  }

  const { csrfToken, appName, scope, deviceAuthId, requestId } = loaderData;
  const actionError = actionData && 'error' in actionData;

  return (
    <AuthCard title={<Trans>Authorize device</Trans>}>
      {actionError && (
        <p role="alert" className="text-sm text-red-700">
          <Trans>Something went wrong. Please return to your device and try again.</Trans>
        </p>
      )}
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
      <RRForm method="post" className="flex flex-col gap-4">
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
