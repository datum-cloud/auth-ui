// app/routes/recover/complete.tsx
//
// The mailed-link landing. `/recover/complete?userId&codeId#code=<code>` — the code is the bearer
// credential, and it arrives in the URL FRAGMENT, not the query (contract v2, zitadel-provider
// #138).
//
// THE FRAGMENT NEVER GOES ON THE WIRE. It is not part of the request line, so the code cannot
// reach an access log, a reverse proxy, an APM trace or a Referer header — which is exactly what
// a query parameter could not promise. The consequence for this route is that THE SERVER NEVER
// SEES THE CODE: the loader does not read it and must never need it. The browser lifts it out of
// `location.hash` into a hidden field and then strips it from the address bar. `userId` and
// `codeId` stay in the query, because neither is usable as a credential on its own.
//
// Belt and braces, `Referrer-Policy: no-referrer` below keeps even that query off any request
// this page originates. It has to be a `headers` export: React Router carries only Set-Cookie off
// a loader's own headers onto a document response, so a header set in the loader's `data()` would
// be silently dropped.
//
// THE LOADER MAKES NO PROVIDER CALL. The code is single-use, so consuming it on the GET would let
// any mail-security scanner or link prefetcher burn it before the user ever clicks — they would
// arrive at a dead link every time. The loader only echoes the query into the page; the ceremony
// starts on the button POST. (Spec §4.1 draws the consume on the GET; this is the recorded
// deviation, and it costs the user one extra click.)
//
// Session-less like /recover: no sessions cookie, no sudo gate.
import { AuthCeremony } from '@/components/auth-ceremony/auth-ceremony';
import { RecoveryCeremonyForm } from '@/components/recovery-ceremony/recovery-ceremony';
import { serializePasskeyHint } from '@/modules/auth/session/passkey-hint';
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
import { Input } from '@datum-cloud/datum-ui/input';
import { Label } from '@datum-cloud/datum-ui/label';
import { Trans } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import {
  Form as RRForm,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type HeadersFunction,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Set up a new passkey' }];

/**
 * No Referer from this page, to anywhere. The URL carries `userId` and `codeId`, and while the
 * code itself is in the fragment (which a Referer never includes anyway), the rest of it should
 * not travel either — not to an image host, not to a link the user follows out.
 *
 * This must be an export: getDocumentHeaders only carries Set-Cookie off `loaderHeaders`, so the
 * same header returned from the loader's `data()` would never reach the browser.
 */
export const headers: HeadersFunction = () => ({ 'Referrer-Policy': 'no-referrer' });

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
      // Echoed straight back into the form. Nothing is validated here — an invalid pair is
      // indistinguishable from a consumed one, and both are answered by the POST below.
      //
      // `code` is deliberately absent: it lives in the fragment, which never reaches this
      // function. Reading one from the query here would quietly reopen the leak the fragment
      // exists to close, by making a `?code=` link work again.
      userId: url.searchParams.get('userId') ?? '',
      codeId: url.searchParams.get('codeId') ?? '',
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
      { headers: await recoveryExitCookies(result.loginName) }
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

async function recoveryExitCookies(loginName: string): Promise<Headers> {
  const headers = new Headers();
  headers.append('set-cookie', await recoveryTicketCookie.serialize('', { maxAge: 0 }));
  headers.append('set-cookie', await recoveryCeremonyCookie.serialize('', { maxAge: 0 }));
  // POINT the hint at the recovered account rather than clearing it. armLoginPasskey's
  // user-bound arm fires only when there is a hint, no live session, and the user has a
  // passkey — which is exactly the state recovery leaves behind. With no hint that arm is
  // skipped, discovery does not auto-prompt, and the user sees a spinner until they reload
  // and sign in by hand. Unlike signup/success.tsx, which clears it, the account here has a
  // real passkey and no half-built session to pollute.
  headers.append('set-cookie', await serializePasskeyHint(loginName));
  return headers;
}

type ActionData =
  { ceremony: true; passkeyId: string; publicKey: unknown } | { error: 'RECOVERY_EXPIRED' };

/**
 * Lifts the code out of `#code=<value>`. Returns null when there is no fragment, when it names no
 * `code`, or when it is empty — every one of which means "ask the user to type it".
 *
 * URLSearchParams rather than a hand-rolled split: it percent-decodes and tolerates the fragment
 * carrying more than one parameter. Its one quirk — `+` decodes to a space — cannot bite here,
 * because the link is built by the webhook and Zitadel's registration codes are alphanumeric.
 */
function codeFromHash(hash: string): string | null {
  if (!hash) return null;
  return new URLSearchParams(hash.replace(/^#/, '')).get('code') || null;
}

export default function RecoverComplete() {
  const { csrfToken, userId, codeId, requestId, organization } = useLoaderData<typeof loader>();
  const actionData = useActionData() as ActionData | undefined;
  const navigation = useNavigation();

  // null until — and unless — a code is found in the fragment. The initial null is not just a
  // starting value: the server renders with it too (it cannot see a fragment), so the typed-code
  // field below is what ships in the HTML and what a reader with JS off is left holding. Flipping
  // the default would hand that reader a form that posts an empty code with nothing to type into.
  const [hashCode, setHashCode] = useState<string | null>(null);

  useEffect(() => {
    const found = codeFromHash(window.location.hash);
    if (!found) return;
    setHashCode(found);
    // Take the credential back out of the URL now that the form holds it. replaceState, not
    // pushState: this is the same navigation with the code removed, not a new one — so it leaves
    // nothing behind in the back/forward entry, in the address bar, or in a screen-share.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

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
        {hashCode === null ? (
          // No fragment, or no JS to read one — the mail prints the code too, so the user can
          // key it in. The sentence is not decoration: without it this is an unlabelled secret
          // asked for out of nowhere, and the reader has no way to know the mail already has it.
          // Deliberately not autoFocused: with a fragment present this field is replaced a tick
          // later, and pulling focus onto a control that is about to disappear is worse than
          // leaving it where it is.
          <div className="flex flex-col gap-2">
            <p className="text-foreground/70 text-sm">
              <Trans>Enter the code from that email to continue.</Trans>
            </p>
            <Label htmlFor="code">
              <Trans>Code</Trans>
            </Label>
            <Input
              id="code"
              name="code"
              // The format is Zitadel configuration we do not own, so there is no shape rule —
              // only the browser affordances that make a mailed code easy to paste.
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
        ) : (
          <input type="hidden" name="code" value={hashCode} />
        )}
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
