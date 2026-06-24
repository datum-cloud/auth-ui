import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { OtpCodeField } from '@/components/auth-ceremony/otp-code-field';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { useAuthActionRecovery } from '@/hooks/use-auth-action-recovery';
import { useLoginContext } from '@/hooks/use-login-context';
import {
  createOtpVerifyHandlers,
  type OtpVerifyActionData,
  type OtpVerifyLoaderData,
} from '@/resources/otp';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { paths } from '@/routes/paths';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import { useActionData, useLoaderData, useNavigation, type MetaFunction } from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Enter your authenticator code' }];

// loader + action come from the shared OTP verify factory. authenticator config: no
// server-sent challenge (the user reads the code from their app — so no resend control either),
// no next=passkey branch, no last-used hint.
// Non-destructured exports: RR7's client build strips `loader`/`action` and cannot remove a
// destructured `export const { loader, action } = …` (matches the enroll-factory routes).
const handlers = createOtpVerifyHandlers({
  channel: 'authenticator',
  writeLastUsedLogin: false,
  verifyPath: paths.login.verify.authenticator(),
});
export const loader = handlers.loader;
export const action = handlers.action;

export default function VerifyAuthenticator() {
  const { csrfToken } = useLoaderData() as OtpVerifyLoaderData;
  const { loginName, requestId, organization } = useLoginContext();
  const actionData = useActionData() as OtpVerifyActionData | undefined;
  const navigation = useNavigation();
  const { t } = useLingui();

  // Shared error pipeline; the message surfaces inline through AuthCeremony,
  // plus an inline recovery <Link> for recoverable codes (e.g. SESSION_EXPIRED → "Sign in again").
  const { message: errorMessage, recovery } = useAuthActionRecovery(actionData, {
    requestId,
    organization,
  });

  return (
    <AuthCeremony
      title={<Trans>Enter your authenticator code</Trans>}
      description={<Trans>Open your authenticator app and enter the 6-digit code.</Trans>}
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
        <OtpCodeField label={t`Authenticator code`} />
        <SubmitButton>
          <Trans>Verify</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCeremony>
  );
}
