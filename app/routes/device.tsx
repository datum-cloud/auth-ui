import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { ProviderError } from '@/providers/types';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { Form } from '@datum-cloud/datum-ui/form';
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

export const meta: MetaFunction = () => [{ title: 'Activate your device' }];

// advisory client-side gate AND the authoritative server-side gate.
// Device codes vary in format across providers; keep this intentionally loose.
const codeSchema = z.object({ userCode: z.string().min(1) });

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data(
    {
      csrfToken,
      userCode: url.searchParams.get('user_code') ?? '',
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = codeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    logAuthEvent('device_code_lookup', 'failure', { reason: 'invalid_code' });
    return data({ error: 'invalid_code' as const }, { status: 400 });
  }

  const { userCode } = parsed.data;

  let deviceAuth;
  try {
    deviceAuth = await provider.getDeviceAuth(userCode);
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'NOT_FOUND') {
      logAuthEvent('device_code_lookup', 'failure', { reason: 'not_found' });
      return data({ error: 'not_found' as const }, { status: 404 });
    }
    throw error;
  }

  logAuthEvent('device_code_lookup', 'success', { deviceAuthId: deviceAuth.id });

  // requestId carries the STABLE user code, not deviceAuth.id: the Zitadel adapter
  // returns a different opaque id per getDeviceAuth call, so the user code is the
  // only handle the ceremony can re-resolve after a login round-trip.
  const params = new URLSearchParams({
    requestId: `device_${userCode}`,
    user_code: userCode,
  });
  return redirect(`/device/authorize?${params.toString()}`);
}

export default function Device() {
  const { csrfToken, userCode } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const error =
    actionData && 'error' in actionData
      ? actionData.error === 'not_found'
        ? 'not_found'
        : 'invalid_code'
      : undefined;

  return (
    <AuthCard
      title={<Trans>Activate your device</Trans>}
      description={<Trans>Enter the code shown on your device to authorize it.</Trans>}>
      <Form.Root
        schema={codeSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ userCode: userCode }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <Form.Field name="userCode" label={t`Device code`} required>
          <Form.Input placeholder={t`WDJB-MJHT`} autoFocus autoComplete="off" />
        </Form.Field>
        {error === 'not_found' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>Code not found. Check your device and try again.</Trans>
          </p>
        )}
        {error === 'invalid_code' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>Invalid code. Please try again.</Trans>
          </p>
        )}
        <SubmitButton>
          <Trans>Continue</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCard>
  );
}
