import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { BackLink } from '@/components/back-link/back-link';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import {
  createOtpEnrollHandlers,
  type OtpEnrollLoaderData,
  type OtpEnrollActionData,
} from '@/resources/otp';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { Trans } from '@lingui/react/macro';
import { useActionData, useLoaderData, useNavigation, type MetaFunction } from 'react-router';
import { Form as RRForm } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Set up email one-time code' }];

const h = createOtpEnrollHandlers({
  enroll: (provider, userId) => provider.addOtpEmail(userId),
  factor: 'otp_email',
  verifyPath: '/login/verify/email',
});
export const loader = h.loader;
export const action = h.action;

export default function SetupEmail() {
  // force is loader-only; the action intentionally doesn't read it.
  const { csrfToken, loginName, requestId, organization, force, checkAfter } =
    useLoaderData() as OtpEnrollLoaderData;
  const actionData = useActionData() as OtpEnrollActionData | undefined;
  const navigation = useNavigation();

  const getErrorMessage = useAuthErrorMessage();
  const errorMessage = getErrorMessage((actionData as { error?: string } | undefined)?.error);
  useActionErrorToast(errorMessage);

  return (
    <AuthCard
      title={<Trans>Set up email one-time code</Trans>}
      description={
        <Trans>
          Add your email address as a second factor. We will send a one-time code each time you sign
          in.
        </Trans>
      }>
      <div className="flex w-full flex-col gap-4">
        <RRForm method="POST" className="flex w-full flex-col gap-4">
          <input type="hidden" name="csrf" value={csrfToken} />
          <input type="hidden" name="loginName" value={loginName} />
          {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          {organization ? <input type="hidden" name="organization" value={organization} /> : null}
          {force ? <input type="hidden" name="force" value={force} /> : null}
          {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
          <SubmitButton loading={navigation.state === 'submitting'}>
            <Trans>Enable email one-time code</Trans>
          </SubmitButton>
        </RRForm>
      </div>

      <BackLink />
    </AuthCard>
  );
}
