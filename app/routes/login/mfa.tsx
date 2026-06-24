import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { useAuthActionRecovery } from '@/hooks/use-auth-action-recovery';
import { useLoginContext } from '@/hooks/use-login-context';
import { readSessions } from '@/modules/auth/session/cookie';
import { resolveMfaPicker, chooseMfaMethod, type SecondFactorMethod } from '@/resources/mfa';
import { readCeremonyParams } from '@/resources/shared/ceremony-params';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { assetUrl } from '@/utils/asset-url';
import { Button } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans } from '@lingui/react/macro';
import { KeyRound, Mail, MessageSquareMore } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
  Form as RRForm,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Choose your verification method' }];

// ─── Labels for each 2nd-factor method ───────────────────────────────────────

const METHOD_LABELS: Record<SecondFactorMethod, { label: ReactNode; icon: ReactNode }> = {
  totp: {
    label: <Trans>Authenticator app</Trans>,
    // Decorative icon: the accessible name comes from the visible "Authenticator app" label,
    // so the img is alt="" + aria-hidden to avoid a doubled screen-reader announcement (F4,
    // same defect as the /setup/mfa row). The other rows use decorative <Icon> SVGs already.
    icon: (
      <img
        src={assetUrl('/images/idps/totp.png')}
        alt=""
        aria-hidden="true"
        className="size-4 object-contain"
      />
    ),
  },
  otp_email: {
    label: <Trans>Email one-time code</Trans>,
    icon: <Icon icon={Mail} size={16} />,
  },
  otp_sms: {
    label: <Trans>SMS one-time code</Trans>,
    icon: <Icon icon={MessageSquareMore} size={16} />,
  },
  u2f: {
    label: <Trans>Security key</Trans>,
    icon: <Icon icon={KeyRound} size={16} />,
  },
};

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { loginName, requestId, organization } = readCeremonyParams(new URL(request.url));

  // Service resolves the session guard, user lookup, policy-filtered 2nd factors, and the
  // single-factor short-circuit. The route only reads the cookie, mints the CSRF token, and
  // wires the result to a redirect or rendered picker.
  const provider = providerForRequest(request);
  const sessions = await readSessions(request);
  const result = await resolveMfaPicker(provider, sessions, { loginName, requestId, organization });
  if (result.kind === 'redirect') return redirect(result.target);

  const { csrfToken, headers } = await loaderCsrf(request);

  return data({ csrfToken, secondFactors: result.secondFactors }, { headers });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form);

  const loginName = (form.get('loginName') as string | null) ?? '';
  const requestId = (form.get('requestId') as string | null) ?? undefined;
  const organization = (form.get('organization') as string | null) ?? undefined;

  // Service does the session guard, schema parse, best-effort userId audit,
  // and routing-target computation. The route reads the cookie, validates CSRF, and wires
  // the result: a SESSION_EXPIRED error redirects to /login (legacy behavior), an
  // INVALID_INPUT error renders a 400, and success redirects to the use screen.
  const provider = providerForRequest(request);
  const sessions = await readSessions(request);
  const result = await chooseMfaMethod(provider, sessions, Object.fromEntries(form), {
    loginName,
    requestId,
    organization,
  });

  if (result.ok) return redirect(result.target);
  if (result.error === 'SESSION_EXPIRED') return redirect(paths.login.index());
  return data({ error: result.error }, { status: 400 });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MfaPicker() {
  const { csrfToken, secondFactors } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useLoginContext();
  const actionData = useActionData<typeof action>();
  // Shared error pipeline; the message surfaces inline through AuthCeremony,
  // plus an inline recovery <Link> for recoverable codes (e.g. SESSION_EXPIRED → "Sign in again").
  const { message: errorMessage, recovery } = useAuthActionRecovery(actionData, {
    requestId,
    organization,
  });

  return (
    <AuthCeremony
      title={<Trans>Two-factor verification</Trans>}
      description={<Trans>Choose how you want to verify your identity.</Trans>}
      error={errorMessage}
      recovery={recovery}
      loginName={loginName}
      requestId={requestId}
      organization={organization}>
      <div className="flex flex-col gap-3">
        {secondFactors.map((method) => (
          <RRForm key={method} method="POST">
            <AuthFormFields
              csrf={csrfToken}
              loginName={loginName}
              requestId={requestId}
              organization={organization}
            />
            <input type="hidden" name="method" value={method} />

            <Button
              size="large"
              className="h-13 gap-3"
              type="quaternary"
              theme="outline"
              block
              htmlType="submit"
              iconPosition="left"
              icon={METHOD_LABELS[method].icon}>
              {METHOD_LABELS[method].label}
            </Button>
          </RRForm>
        ))}
      </div>
    </AuthCeremony>
  );
}
