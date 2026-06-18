import { AuthCard } from '@/components/auth-card/auth-card';
import { BackLink } from '@/components/back-link/back-link';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { readSessions } from '@/modules/auth/session/cookie';
import { resolveMfaPicker, chooseMfaMethod, type SecondFactorMethod } from '@/resources/mfa';
import { type LoginLayoutData } from '@/routes/login/layout';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { Button } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans } from '@lingui/react/macro';
import { KeyRound, Mail, MessageSquareMore } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  data,
  redirect,
  useLoaderData,
  useRouteLoaderData,
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
    icon: <img src="/idps/totp.png" alt="Authenticator app" className="size-4 object-contain" />,
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
  const url = new URL(request.url);
  const loginName = url.searchParams.get('loginName') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;

  // Service resolves the session guard, user lookup, policy-filtered 2nd factors, and the
  // single-factor short-circuit. The route only reads the cookie, mints the CSRF token, and
  // wires the result to a redirect or rendered picker.
  const provider = providerForRequest(request);
  const sessions = await readSessions(request);
  const result = await resolveMfaPicker(provider, sessions, { loginName, requestId, organization });
  if (result.kind === 'redirect') return redirect(result.target);

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data({ csrfToken, secondFactors: result.secondFactors }, { headers });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form);

  const loginName = (form.get('loginName') as string | null) ?? '';
  const requestId = (form.get('requestId') as string | null) ?? undefined;
  const organization = (form.get('organization') as string | null) ?? undefined;

  // Service does the session guard, schema parse, best-effort userId audit (CODE-MIN-28),
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
  if (result.error === 'SESSION_EXPIRED') return redirect('/login');
  return data({ error: result.error }, { status: 400 });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MfaPicker() {
  const { csrfToken, secondFactors } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useRouteLoaderData('login') as LoginLayoutData;

  return (
    <AuthCard
      title={<Trans>Two-factor verification</Trans>}
      description={<Trans>Choose how you want to verify your identity.</Trans>}>
      <div className="flex flex-col items-baseline justify-center gap-4">
        <IdentityBadge loginName={loginName} requestId={requestId} organization={organization} />
        <div className="flex flex-col gap-3">
          {secondFactors.map((method) => (
            <RRForm key={method} method="POST">
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="loginName" value={loginName} />
              <input type="hidden" name="method" value={method} />
              {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
              {organization ? (
                <input type="hidden" name="organization" value={organization} />
              ) : null}

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

        <BackLink />
      </div>
    </AuthCard>
  );
}
