import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { FormError } from '@/components/form-error/form-error';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { lookupDeviceCode, lookupOutcomeToResponse } from '@/resources/device';
import { codeSchema } from '@/resources/device/device.schema';
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

  // Inline-only error surface: the action error renders in a <FormError> (role="alert")
  // inside the form — no toast.
  const errorMessage = useAuthActionError(actionData);

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
        className="flex w-full flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <Form.Field name="userCode" label={t`Device code`} required>
          <Form.Input placeholder={t`WDJB-MJHT`} autoFocus autoComplete="off" />
        </Form.Field>
        <FormError>{errorMessage}</FormError>
        <SubmitButton>
          <Trans>Continue</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCard>
  );
}
