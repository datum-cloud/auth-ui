import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { OtpCodeField } from '@/components/auth-ceremony/otp-code-field';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { useAuthActionRecovery } from '@/hooks/use-auth-action-recovery';
import {
  createOtpVerifyHandlers,
  type OtpVerifyActionData,
  type OtpVerifyLoaderData,
} from '@/resources/otp';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { paths } from '@/routes/paths';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteLoaderData,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Enter your SMS code' }];

// loader + action come from the shared OTP verify factory. sms config: send the SMS
// challenge on arrival; no next=passkey branch; no last-used hint (2nd factor).
// Non-destructured exports: RR7's client build strips `loader`/`action` and cannot remove a
// destructured `export const { loader, action } = …` (matches the enroll-factory routes).
const handlers = createOtpVerifyHandlers({
  channel: 'sms',
  writeLastUsedLogin: false,
  verifyPath: paths.login.verify.sms(),
});
export const loader = handlers.loader;
export const action = handlers.action;

export default function VerifySms() {
  const { csrfToken } = useLoaderData() as OtpVerifyLoaderData;
  // RR7 infers the parent-layout loader return through the generic — the `as` cast is gone.
  // The `?? { loginName: '' }` only satisfies the structurally-possible-undefined branch; these
  // routes always render under the `login` layout, so it is never taken at runtime.
  const { loginName, requestId, organization } = useRouteLoaderData<
    typeof import('@/routes/login/layout').loader
  >('login') ?? { loginName: '' };
  const actionData = useActionData() as OtpVerifyActionData | undefined;
  const navigation = useNavigation();
  const { t } = useLingui();

  // Shared error pipeline; the message surfaces inline through AuthCeremony,
  // plus an inline recovery <Link> for recoverable codes (e.g. SESSION_EXPIRED → "Sign in again").
  const { message: errorMessage, recovery } = useAuthActionRecovery(actionData);

  return (
    <AuthCeremony
      title={<Trans>Enter your SMS code</Trans>}
      description={<Trans>Enter the one-time code sent to your phone.</Trans>}
      error={errorMessage}
      recovery={recovery}
      loginName={loginName}
      requestId={requestId}
      organization={organization}>
      <Form.Root
        schema={otpCodeClientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ code: '' }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex w-full flex-col gap-4">
        <AuthFormFields
          csrf={csrfToken}
          loginName={loginName}
          requestId={requestId}
          organization={organization}
        />
        <OtpCodeField label={t`SMS code`} />
        <SubmitButton>
          <Trans>Verify</Trans>
        </SubmitButton>
      </Form.Root>

      {/* Resend re-sends the code (the loader re-dispatches after this POST redirects back). */}
      <RRForm method="POST" className="w-full">
        <AuthFormFields
          csrf={csrfToken}
          loginName={loginName}
          requestId={requestId}
          organization={organization}
        />
        <input type="hidden" name="intent" value="resend" />
        <button type="submit" className="text-sm underline">
          <Trans>Resend code</Trans>
        </button>
      </RRForm>
    </AuthCeremony>
  );
}
