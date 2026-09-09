// app/routes/recover/complete.tsx
//
// The mailed-link landing. `/recover/complete?userId&codeId&code[&requestId&organization]` — the
// triple in that query IS the bearer credential, which is why this is the only route that accepts
// it from a URL.
//
// THE LOADER MAKES NO PROVIDER CALL. The code is single-use, so consuming it on the GET would let
// any mail-security scanner or link prefetcher burn it before the user ever clicks — they would
// arrive at a dead link every time. The loader only echoes the triple into the page; the ceremony
// starts on the button POST. (Spec §4.1 draws the consume on the GET; this is the recorded
// deviation, and it costs the user one extra click.)
//
// Session-less like /recover: no sessions cookie, no sudo gate.
import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { RecoveryCeremonyForm } from '@/components/recovery-ceremony/recovery-ceremony';
import {
  finishRecoveryCeremony,
  startRecoveryCeremony,
} from '@/resources/recovery/recovery-ceremony';
import {
  recoveryCeremonyCookie,
  recoveryTicketCookie,
} from '@/resources/recovery/recovery-ticket.server';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { assertCsrf, loaderCsrf } from '@/server/csrf';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import {
  Form as RRForm,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Set up a new passkey' }];

/** Merging is not activating: while the flag is off this route does not exist, from either verb. */
function assertEnabled() {
  if (!env.AUTH_ACCOUNT_RECOVERY_ENABLED) throw data(null, { status: 404 });
}

export async function loader({ request }: LoaderFunctionArgs) {
  assertEnabled();
  const url = new URL(request.url);
  const { csrfToken, headers } = await loaderCsrf(request);
  return data(
    {
      csrfToken,
      // Echoed straight back into the form. Nothing is validated here — an invalid triple is
      // indistinguishable from a consumed one, and both are answered by the POST below.
      userId: url.searchParams.get('userId') ?? '',
      codeId: url.searchParams.get('codeId') ?? '',
      code: url.searchParams.get('code') ?? '',
      requestId: url.searchParams.get('requestId') ?? undefined,
      organization: url.searchParams.get('organization') ?? undefined,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  assertEnabled();
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  if (form.get('intent') === 'verify') {
    const result = await finishRecoveryCeremony(provider, request, form, 'link');
    if (!result.ok) return data({ error: 'RECOVERY_EXPIRED' as const }, { status: 400 });
    return redirect(
      paths.login.index({
        loginName: result.loginName,
        requestId: String(form.get('requestId') ?? '') || undefined,
        organization: String(form.get('organization') ?? '') || undefined,
        notice: 'passkey-recovered',
      }),
      { headers: await clearRecoveryCookies() }
    );
  }

  // intent=start — the deliberate extra click that keeps a prefetch from burning the code.
  const started = await startRecoveryCeremony(provider, {
    userId: String(form.get('userId') ?? ''),
    codeId: String(form.get('codeId') ?? ''),
    code: String(form.get('code') ?? ''),
    domain: new URL(trustedAppOrigin(request)).hostname,
    path: 'link',
  });
  if (!started.ok) return data({ error: 'RECOVERY_EXPIRED' as const }, { status: 400 });

  return data(
    { ceremony: true as const, passkeyId: started.passkeyId, publicKey: started.publicKey },
    { status: 200, headers: { 'set-cookie': started.setCookie } }
  );
}

async function clearRecoveryCookies(): Promise<Headers> {
  const headers = new Headers();
  headers.append('set-cookie', await recoveryTicketCookie.serialize('', { maxAge: 0 }));
  headers.append('set-cookie', await recoveryCeremonyCookie.serialize('', { maxAge: 0 }));
  return headers;
}

type ActionData =
  { ceremony: true; passkeyId: string; publicKey: unknown } | { error: 'RECOVERY_EXPIRED' };

export default function RecoverComplete() {
  const { csrfToken, userId, codeId, code, requestId, organization } =
    useLoaderData<typeof loader>();
  const actionData = useActionData() as ActionData | undefined;
  const navigation = useNavigation();

  if (actionData && ('ceremony' in actionData || actionData.error === 'RECOVERY_EXPIRED')) {
    return (
      <RecoveryCeremonyForm
        csrfToken={csrfToken}
        publicKey={'ceremony' in actionData ? actionData.publicKey : null}
        passkeyId={'ceremony' in actionData ? actionData.passkeyId : ''}
        requestId={requestId}
        organization={organization}
        error={'error' in actionData ? actionData.error : undefined}
      />
    );
  }

  return (
    <AuthCeremony
      title={<Trans>Set up a new passkey</Trans>}
      description={
        <Trans>
          Continue to register a passkey on this device. This link works only once, so finish here
          before closing the page.
        </Trans>
      }>
      <RRForm method="POST" className="flex w-full flex-col gap-4">
        <input type="hidden" name="csrf" value={csrfToken} />
        <input type="hidden" name="intent" value="start" />
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="codeId" value={codeId} />
        <input type="hidden" name="code" value={code} />
        {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
        {organization ? <input type="hidden" name="organization" value={organization} /> : null}
        <Button
          type="primary"
          theme="solid"
          htmlType="submit"
          block
          loading={navigation.state !== 'idle'}>
          <Trans>Continue</Trans>
        </Button>
      </RRForm>
    </AuthCeremony>
  );
}
