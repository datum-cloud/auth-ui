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

export const meta: MetaFunction = () => [{ title: 'Enter your email code' }];

// loader + action come from the shared OTP verify factory. email config: send the email
// challenge (suppressed on the ?code link path), support next=passkey, and record last-used='email'.
// Non-destructured exports: RR7's client build strips `loader`/`action` and cannot remove a
// destructured `export const { loader, action } = …` (matches the enroll-factory routes).
const handlers = createOtpVerifyHandlers({
  channel: 'email',
  suppressChallengeOnCode: true,
  nextParamHandling: 'passkey-redirect',
  writeLastUsedLogin: 'email',
  verifyPath: paths.login.verify.email(),
});
export const loader = handlers.loader;
export const action = handlers.action;

export default function VerifyEmail() {
  const { csrfToken, code, next } = useLoaderData() as OtpVerifyLoaderData;
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
      title={<Trans>Enter your email code</Trans>}
      description={<Trans>Enter the one-time code sent to your email address.</Trans>}
      error={errorMessage}
      recovery={recovery}
      loginName={loginName}
      requestId={requestId}
      organization={organization}>
      <Form.Root
        schema={otpCodeClientSchema}
        formComponent={RRForm}
        method="POST"
        defaultValues={{ code }}
        isSubmitting={navigation.state === 'submitting'}
        className="flex w-full flex-col gap-4">
        <AuthFormFields
          csrf={csrfToken}
          loginName={loginName}
          requestId={requestId}
          organization={organization}
          next={next ? next : undefined}
        />
        <OtpCodeField label={t`Email code`} />
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
