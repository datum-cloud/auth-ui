import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { OtpCodeField } from '@/components/auth-ceremony/otp-code-field';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { useAuthActionRecovery } from '@/hooks/use-auth-action-recovery';
import { readSessions, byLoginName } from '@/modules/auth/session/cookie';
import { setupSkipSchema } from '@/resources/mfa/mfa.schema';
import { enrollTotp } from '@/resources/otp';
import { otpCodeClientSchema } from '@/resources/otp/otp.schema';
import { readCeremonyParams } from '@/resources/shared/ceremony-params';
import { redirectToLogin } from '@/routes/login-bounce';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import { QRCodeSVG } from 'qrcode.react';
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

export const meta: MetaFunction = () => [{ title: 'Set up authenticator app' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const { loginName, requestId, organization } = readCeremonyParams(url);
  const { force, checkAfter } = setupSkipSchema.parse(Object.fromEntries(url.searchParams));

  // Guard: require an active session for this loginName (mirror login.verify.authenticator.tsx).
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);
  if (!entry) return redirect(redirectToLogin(requestId, organization));

  // Resolve userId via findUser — SessionEntry carries no userId field (mirror login.mfa.tsx).
  const provider = providerForRequest(request);
  const user = await provider.findUser(loginName, organization);
  if (!user) return redirect(redirectToLogin(requestId, organization));

  // Register TOTP: returns deterministic { uri, secret } in fake; real adapter generates a new key.
  const { uri, secret } = await provider.registerTotp(user.id);

  const { csrfToken, headers } = await loaderCsrf(request);

  return data(
    { csrfToken, loginName, requestId, organization, force, checkAfter, uri, secret },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const formEntries = Object.fromEntries(form);
  const organization = (formEntries.organization as string) || undefined;
  const loginName = (formEntries.loginName as string) ?? '';

  // Resolve the active session entry from the SIGNED cookie (mirror login.mfa.tsx).
  const sessions = await readSessions(request);
  const entry = byLoginName(sessions, loginName, organization);

  const result = await enrollTotp(provider, formEntries, entry ?? undefined);
  if (!result.ok) {
    const status = result.error === 'INVALID_CREDENTIALS' ? 401 : 400;
    return data({ error: result.error }, { status });
  }

  return redirect(result.target);
}

export default function SetupAuthenticator() {
  const { csrfToken, loginName, requestId, organization, force, checkAfter, uri, secret } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  // Inline message + a recovery <Link> for recoverable codes (SESSION_EXPIRED → "Sign in again").
  const { message: errorMessage, recovery } = useAuthActionRecovery(actionData, {
    requestId,
    organization,
  });

  return (
    <AuthCeremony
      title={<Trans>Set up authenticator app</Trans>}
      description={
        <Trans>
          Scan the QR code below with your authenticator app, then enter the 6-digit code to confirm
          enrollment.
        </Trans>
      }
      error={errorMessage}
      recovery={recovery}
      loginName={loginName}
      requestId={requestId}
      organization={organization}>
      {/* Scannable QR of the otpauth URI. Rendered ABOVE the manual-key
          fallback (kept for authenticators that accept manual URI/secret import, or when
          the camera isn't available). Explicit dimensions avoid layout shift; the white
          frame preserves the quiet-zone contrast scanners need. */}
      <div className="flex w-full justify-center">
        {/* 755-M4: bg-white below is intentional in BOTH themes — a TOTP QR needs a light quiet
            zone for reliable camera scanning; it must NOT flip to a dark surface. */}
        <QRCodeSVG
          data-testid="totp-qr"
          value={uri}
          size={180}
          width={180}
          height={180}
          marginSize={2}
          className="rounded-md bg-white p-3"
          title={t`Authenticator QR code`}
          aria-label={t`Authenticator QR code`}
        />
      </div>

      {/* Manual entry fallback — the otpauth URI and the raw secret. Kept for
          authenticators that accept manual URI/secret import, or when the camera
          is unavailable. */}
      <div className="bg-muted flex w-full flex-col gap-2 rounded-md p-4 text-sm">
        <p className="font-medium">
          <Trans>Manual setup key</Trans>
        </p>
        <code
          data-testid="totp-secret"
          className="font-mono text-base tracking-widest break-all select-all">
          {secret}
        </code>
        <p className="mt-2 font-medium">
          <Trans>Or import this URI in your authenticator app</Trans>
        </p>
        <code
          data-testid="totp-uri"
          className="text-foreground font-mono text-xs break-all select-all">
          {uri}
        </code>
      </div>

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
        {force ? <input type="hidden" name="force" value={force} /> : null}
        {checkAfter ? <input type="hidden" name="checkAfter" value={checkAfter} /> : null}
        <OtpCodeField label={t`Authenticator code`} />
        <SubmitButton>
          <Trans>Verify and enable</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCeremony>
  );
}
