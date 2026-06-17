import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import { ProviderError } from '@/providers/types';
import { signInWithIdpIntent } from '@/routes/_shared/idp-session';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
import { Form } from '@datum-cloud/datum-ui/form';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
  Form as RRForm,
} from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Sign in with LDAP' }];

// ── Client-side schema (visible fields only) ──────────────────────────────────

const ldapClientSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// ── Server-side schema (full form including hidden fields) ────────────────────
// LDAP account-linking (link=true) is not wired — see the /sso action guard.

const ldapServerSchema = ldapClientSchema.extend({
  idpId: z.string().min(1),
  requestId: z.string().optional(),
  organization: z.string().optional(),
});

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const idpId = url.searchParams.get('idpId') ?? '';
  const requestId = url.searchParams.get('requestId') ?? undefined;
  const organization = url.searchParams.get('organization') ?? undefined;

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data({ csrfToken, idpId, requestId, organization }, { headers });
}

// ── Action ────────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = ldapServerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    logAuthEvent('ldap_signin', 'failure', { reason: 'invalid_input' });
    return data({ error: 'invalid_input' as const }, { status: 400 });
  }

  const { idpId, username, requestId, organization } = parsed.data;

  let ldapIntent;
  try {
    ldapIntent = await provider.startLdapIntent(idpId, username, parsed.data.password);
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.code === 'INVALID_CREDENTIALS') {
        logAuthEvent('ldap_signin', 'failure', { reason: error.code, idpId });
        return data({ error: 'INVALID_CREDENTIALS' as const }, { status: 401 });
      }
      logAuthEvent('ldap_signin', 'failure', { reason: error.code, idpId });
      return data({ error: error.code as string }, { status: 400 });
    }
    throw error;
  }

  const { userId, idpIntentId, idpIntentToken } = ldapIntent;

  // Real Zitadel returns valid LDAP credentials with an empty userId when the IdP
  // user is NOT linked to any Zitadel account (the resolved intent is a 'register'
  // draft, not a sign-in). Proceeding to createSession throws [failed_precondition]
  // 'User ID missing' → an uncaught 500. Direct sign-in only supports already-linked
  // accounts; register-and-link via LDAP is deferred (see /sso ldap-link guard).
  // Fail gracefully with a typed error instead of leaking a 500.
  if (!userId) {
    logAuthEvent('ldap_signin', 'failure', { reason: 'account_not_linked', idpId });
    return data({ error: 'ACCOUNT_NOT_LINKED' as const }, { status: 403 });
  }

  const { setCookie, target } = await signInWithIdpIntent(provider, request, {
    idpIntentId,
    idpIntentToken,
    userId,
    requestId,
    organization,
    fallbackLoginName: username,
  });

  logAuthEvent('ldap_signin', 'success', { idpId, userId, requestId });

  return redirect(target, { headers: { 'set-cookie': setCookie } });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SsoLdap() {
  const { csrfToken, idpId, requestId, organization } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  const error = actionData && 'error' in actionData ? actionData.error : undefined;

  return (
    <AuthCard title={<Trans>Sign in with LDAP</Trans>}>
      <Form.Root
        schema={ldapClientSchema}
        formComponent={RRForm}
        method="POST"
        isSubmitting={navigation.state === 'submitting'}
        className="flex flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="idpId" value={idpId} />
        {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
        {organization ? <input type="hidden" name="organization" value={organization} /> : null}

        <Form.Field name="username" label={t`Username`} required>
          <Form.Input autoFocus autoComplete="username" />
        </Form.Field>

        <Form.Field name="password" label={t`Password`} required>
          <Form.Input type="password" autoComplete="current-password" />
        </Form.Field>

        {error === 'INVALID_CREDENTIALS' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>Invalid username or password.</Trans>
          </p>
        )}
        {error === 'ACCOUNT_NOT_LINKED' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>
              No account is linked to these LDAP credentials. Please contact your administrator.
            </Trans>
          </p>
        )}
        {error && error !== 'INVALID_CREDENTIALS' && error !== 'ACCOUNT_NOT_LINKED' && (
          <p role="alert" className="text-sm text-red-700">
            <Trans>An error occurred. Please try again.</Trans>
          </p>
        )}

        <SubmitButton>
          <Trans>Sign in</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCard>
  );
}
