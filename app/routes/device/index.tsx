import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { codeSchema } from '@/resources/device/device.schema';
import { lookupDeviceCode, lookupOutcomeToResponse } from '@/resources/device';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { Form } from '@datum-cloud/datum-ui/form';
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

export const meta: MetaFunction = () => [{ title: 'Activate your device' }];

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

  const outcome = await lookupDeviceCode(provider, form);
  return lookupOutcomeToResponse(outcome);
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
