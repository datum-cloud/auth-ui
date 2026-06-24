import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { useAuthActionRecovery } from '@/hooks/use-auth-action-recovery';
import { createOtpEnrollHandlers, type OtpEnrollActionData } from '@/resources/otp';
import { paths } from '@/routes/paths';
import { Trans } from '@lingui/react/macro';
import { useActionData, useLoaderData, useNavigation, type MetaFunction } from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Set up SMS one-time code' }];

const h = createOtpEnrollHandlers({
  enroll: (provider, userId) => provider.addOtpSms(userId),
  factor: 'otp_sms',
  verifyPath: paths.login.verify.sms(),
});
export const loader = h.loader;
export const action = h.action;

export default function SetupSms() {
  // force is loader-only; the action intentionally doesn't read it.
  // The loader is a locally-exported `const loader = h.loader`, so RR7 infers its return
  // (data<OtpEnrollLoaderData>) through the generic — the `as` cast is gone.
  const { csrfToken, loginName, requestId, organization, force, checkAfter } =
    useLoaderData<typeof loader>();
  const actionData = useActionData() as OtpEnrollActionData | undefined;
  const navigation = useNavigation();

  // Inline message + a recovery <Link> for recoverable codes (SESSION_EXPIRED → "Sign in again").
  const { message: errorMessage, recovery } = useAuthActionRecovery(actionData, {
    requestId,
    organization,
  });

  return (
    <AuthCeremony
      title={<Trans>Set up SMS one-time code</Trans>}
      description={
        <Trans>
          Add your phone number as a second factor. We will send a one-time code via SMS each time
          you sign in.
        </Trans>
      }
      error={errorMessage}
      recovery={recovery}
      loginName={loginName}
      requestId={requestId}
      organization={organization}>
      <RRForm method="POST" className="flex w-full flex-col gap-4">
        <AuthFormFields
          csrf={csrfToken}
          loginName={loginName}
          requestId={requestId}
          organization={organization}
        />
        {force ? <input type="hidden" name="force" value={force} /> : null}
        {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
        <SubmitButton loading={navigation.state === 'submitting'}>
          <Trans>Enable SMS one-time code</Trans>
        </SubmitButton>
      </RRForm>
    </AuthCeremony>
  );
}
