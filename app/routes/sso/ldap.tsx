import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import { submitLdapCredentials, outcomeToResponse, type LdapActionData } from '@/resources/sso';
import { ldapClientSchema } from '@/resources/sso/sso.schema';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
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
  Form as RRForm,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Sign in with LDAP' }];

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

  // All validation, provider-error mapping, the unlinked-user guard, and the session
  // mint live in submitLdapCredentials; the route only asserts CSRF and translates.
  const outcome = await submitLdapCredentials(provider, request, form);
  return outcomeToResponse(outcome);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SsoLdap() {
  const { csrfToken, idpId, requestId, organization } = useLoaderData<typeof loader>();
  const actionData = useActionData() as LdapActionData | undefined;
  const navigation = useNavigation();
  const { t } = useLingui();

  const getErrorMessage = useAuthErrorMessage();
  useActionErrorToast(getErrorMessage((actionData as { error?: string } | undefined)?.error));

  return (
    <AuthCard title={<Trans>Sign in with LDAP</Trans>}>
      <Form.Root
        schema={ldapClientSchema}
        formComponent={RRForm}
        method="POST"
        isSubmitting={navigation.state === 'submitting'}
        className="flex w-full flex-col gap-4">
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

        <SubmitButton>
          <Trans>Sign in</Trans>
        </SubmitButton>
      </Form.Root>
    </AuthCard>
  );
}
