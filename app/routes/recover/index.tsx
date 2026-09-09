// app/routes/recover/index.tsx
//
// The self-serve recovery door. Three intents on one action:
//
//   request  an address -> mail a passkey registration code (or resume an unfinished signup)
//   code     the code from that mail, typed on THIS device -> open the passkey ceremony
//   verify   the credential the browser produced -> new passkey, then /login
//
// G7: EVERY `request` exit returns the same status, the same body and a Set-Cookie of the same
// length. Whether the address is unknown, refused, limited, undeliverable or real, the browser
// sees `{ sent: true, email }` with a ticket cookie — real or filler. `waitUntilDeadline` runs
// before every exit so the timing class matches too. The service (requestRecovery) owns which
// side effect happens; this route owns only the fact that none of it is observable.
//
// This route never reads the sessions cookie and never applies the sudo gate: the mailed code is
// the authorisation. See recovery-ceremony.ts.
import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { RecoveryCeremonyForm } from '@/components/recovery-ceremony/recovery-ceremony';
import { useRecaptcha } from '@/modules/fraud/recaptcha';
import { requestRecovery } from '@/resources/recovery';
import {
  finishRecoveryCeremony,
  startRecoveryCeremony,
} from '@/resources/recovery/recovery-ceremony';
import {
  fillerTicket,
  openRequestTicket,
  recoveryCeremonyCookie,
  recoveryTicketCookie,
} from '@/resources/recovery/recovery-ticket.server';
import { recoveryCodeSchema, recoveryRequestSchema } from '@/resources/recovery/recovery.schema';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { assertCsrf, loaderCsrf } from '@/server/csrf';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { recaptchaRejects } from '@/server/infra/recaptcha.server';
import { waitUntilDeadline } from '@/server/timing';
import { Button } from '@datum-cloud/datum-ui/button';
import { Input } from '@datum-cloud/datum-ui/input';
import { Label } from '@datum-cloud/datum-ui/label';
import { Trans, useLingui } from '@lingui/react/macro';
import { useRef, useState } from 'react';
import {
  Link,
  Form as RRForm,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Recover your account' }];

/** Merging is not activating: while the flag is off this route does not exist, from either verb. */
function assertEnabled() {
  if (!env.AUTH_ACCOUNT_RECOVERY_ENABLED) throw data(null, { status: 404 });
}

export async function loader({ request }: LoaderFunctionArgs) {
  assertEnabled();
  const provider = providerForRequest(request);
  const url = new URL(request.url);
  const organization = url.searchParams.get('organization') ?? undefined;
  const requestId = url.searchParams.get('requestId') ?? undefined;

  const { csrfToken, headers } = await loaderCsrf(request);
  const settingsOrg = await resolveOrg(provider, organization);
  const branding = await provider.getBranding(settingsOrg);

  return data(
    {
      csrfToken,
      branding,
      organization,
      requestId,
      recaptchaSiteKey: env.RECAPTCHA_SITE_KEY ?? '',
      // Entry points hand the address across so the user does not retype it.
      prefill: {
        email: url.searchParams.get('email') ?? url.searchParams.get('loginName') ?? '',
      },
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  assertEnabled();
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);
  const intent = form.get('intent');

  // ── verify: finish the ceremony the code opened ────────────────────────────────────────────
  // No deadline padding: this branch is reached only by someone who already consumed a valid
  // code, so there is nothing left to enumerate.
  if (intent === 'verify') {
    const result = await finishRecoveryCeremony(provider, request, form, 'code');
    if (!result.ok) return data({ error: 'RECOVERY_EXPIRED' as const }, { status: 400 });
    return redirect(
      paths.login.index({
        loginName: result.loginName,
        requestId: String(form.get('requestId') ?? '') || undefined,
        organization: String(form.get('organization') ?? '') || undefined,
        notice: 'passkey-recovered',
      }),
      // Both tickets are spent. Clearing them keeps a back-button replay from re-posting a
      // ceremony whose code is already gone.
      { headers: await clearRecoveryCookies() }
    );
  }

  // ── code: the mailed code, typed on the device that asked ──────────────────────────────────
  if (intent === 'code') {
    // Stamped at BRANCH ENTRY so every exit below leaves at the same deadline.
    const startedAt = Date.now();
    const parsed = recoveryCodeSchema.safeParse(Object.fromEntries(form));
    const identified = recoveryRequestSchema
      .pick({ email: true })
      .safeParse(Object.fromEntries(form));

    // ONE answer for every failure — wrong code, foreign ticket, filler ticket, no ticket at all.
    // Re-renders the terminal (not a bare error) so a typo does not drop the user on an empty
    // form with the address gone.
    const invalidCode = async () => {
      await waitUntilDeadline(startedAt);
      return identified.success
        ? data(
            { sent: true as const, email: identified.data.email, error: 'INVALID_CODE' as const },
            { status: 400 }
          )
        : data({ error: 'INVALID_CODE' as const }, { status: 400 });
    };

    // Bot gate before any provider work, so a rejection costs what an acceptance costs.
    // A distinct action name per intent: a request token cannot be replayed against code entry.
    if (await recaptchaRejects(String(form.get('recaptchaToken') ?? ''), 'recovery_code')) {
      return invalidCode();
    }
    if (!parsed.success) return invalidCode();

    // The userId and codeId come from the SEALED TICKET, never from the form — the schema has no
    // userId field at all, so a hand-crafted POST cannot name another account.
    const ticket = openRequestTicket(
      (await recoveryTicketCookie.parse(request.headers.get('cookie'))) as string | null,
      parsed.data.email
    );
    if (!ticket) return invalidCode();

    const started = await startRecoveryCeremony(provider, {
      userId: ticket.userId,
      codeId: ticket.codeId,
      code: parsed.data.code,
      domain: new URL(trustedAppOrigin(request)).hostname,
      path: 'code',
    });
    if (!started.ok) return invalidCode();

    await waitUntilDeadline(startedAt);
    return data(
      {
        ceremony: true as const,
        email: parsed.data.email,
        passkeyId: started.passkeyId,
        publicKey: started.publicKey,
      },
      { status: 200, headers: { 'set-cookie': started.setCookie } }
    );
  }

  // ── request: the address form ──────────────────────────────────────────────────────────────
  // t0 for the constant-time deadline every exit below leaves at. The seven responses that MUST
  // stay indistinguishable cost very different work: a suppressed exit stops at the limiter or at
  // findUser, while the sent path adds listAuthMethods, getLoginSettings, passkeyRegisterLink and
  // a mail POST. Without a shared deadline that gap is an account-existence oracle, which is the
  // one thing the generic response exists to deny.
  //
  // Bounded, like every deadline: it equalises only while the real work finishes inside the floor.
  // The sent path AWAITS the webhook POST inside that floor, so a slow or degraded mail webhook
  // leaves a measurable tail that the suppressed exits do not have. ACCEPTED by the owner
  // (2026-09-10): it is the same residual signup's squatted branch has always carried — see the
  // matching note in routes/signup/index.tsx — and the send is what makes the ticket meaningful.
  // Recorded here rather than quietly dropped. FOLLOW-UP: if staging measurements show the tail is
  // actually separable, move the send off the request path (fire-and-forget or a queue) so the
  // response no longer waits on it; nothing else about this branch would change.
  const startedAt = Date.now();
  const parsed = recoveryRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    await waitUntilDeadline(startedAt);
    return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  }
  const { email, organization, requestId } = parsed.data;

  // A rejected bot gets the SAME terminal as everyone else, with a filler ticket. Telling it
  // apart would hand back the enumeration signal the whole branch exists to remove — so the
  // rejection is silent and the request simply never runs.
  const rejected = await recaptchaRejects(String(form.get('recaptchaToken') ?? ''), 'recovery');
  const ticket = rejected
    ? fillerTicket()
    : (
        await requestRecovery(provider, {
          email,
          organization,
          requestId,
          // Trusted config origin (PUBLIC_ORIGIN), NOT the request Host header — blocks
          // Host-header injection into the emailed link.
          origin: trustedAppOrigin(request),
        })
      ).ticket;

  await waitUntilDeadline(startedAt);
  return data(
    { sent: true as const, email },
    { status: 200, headers: { 'set-cookie': await recoveryTicketCookie.serialize(ticket) } }
  );
}

/** Both recovery cookies, expired. Serialized with a null value so the browser drops them. */
async function clearRecoveryCookies(): Promise<Headers> {
  const headers = new Headers();
  headers.append('set-cookie', await recoveryTicketCookie.serialize('', { maxAge: 0 }));
  headers.append('set-cookie', await recoveryCeremonyCookie.serialize('', { maxAge: 0 }));
  return headers;
}

type ActionData =
  | { sent: true; email: string; error?: 'INVALID_CODE' }
  | { ceremony: true; email: string; passkeyId: string; publicKey: unknown }
  | { error: 'INVALID_CODE' | 'INVALID_INPUT' | 'RECOVERY_EXPIRED' };

export default function Recover() {
  const { csrfToken, branding, organization, requestId, recaptchaSiteKey, prefill } =
    useLoaderData<typeof loader>();
  const actionData = useActionData() as ActionData | undefined;
  const navigation = useNavigation();
  const { t } = useLingui();
  const submit = useSubmit();

  const mintRecaptchaToken = useRecaptcha(recaptchaSiteKey);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [minting, setMinting] = useState(false);
  const inFlight = useRef(false);

  // Interception happens on the form's submit EVENT, not a button onClick: each form has one
  // blocking field and so submits natively on Enter, which runs no onClick at all.
  async function handleSubmit(
    ref: React.RefObject<HTMLInputElement | null>,
    recaptchaAction: 'recovery' | 'recovery_code'
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setMinting(true);
    try {
      const formEl = ref.current?.form;
      if (!formEl) return;
      // Snapshot BEFORE the await: the form can be reset during this same submit cycle, so a
      // post-await DOM read can come back already cleared.
      const formData = new FormData(formEl);
      const token = await mintRecaptchaToken(recaptchaAction);
      // Unconfigured deployments send no field at all, not just render none.
      if (recaptchaSiteKey) formData.set('recaptchaToken', token ?? '');
      submit(formData, { method: 'post' });
    } finally {
      inFlight.current = false;
      setMinting(false);
    }
  }

  const submitting = navigation.state === 'submitting' || minting;

  if (actionData && 'ceremony' in actionData) {
    return (
      <RecoveryCeremonyForm
        csrfToken={csrfToken}
        publicKey={actionData.publicKey}
        passkeyId={actionData.passkeyId}
        requestId={requestId}
        organization={organization}
      />
    );
  }

  const sent = actionData && 'sent' in actionData ? actionData : undefined;

  // ── the check-your-email terminal ────────────────────────────────────────────────────────────
  if (sent) {
    return (
      <AuthCard branding={branding} title={<Trans>Check your email</Trans>}>
        <p className="text-foreground/70 text-sm">
          <Trans>
            We've sent a link to <strong>{sent.email}</strong>. Open it on the device you want to
            sign in with, or enter the code from that email here.
          </Trans>
        </p>
        <RRForm
          method="POST"
          className="flex w-full flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit(codeRef, 'recovery_code');
          }}>
          <AuthFormFields csrf={csrfToken} requestId={requestId} organization={organization} />
          <input type="hidden" name="intent" value="code" />
          <input type="hidden" name="email" value={sent.email} />
          {sent.error === 'INVALID_CODE' ? (
            <FormError>
              <Trans>That code is invalid or has expired. Check the email, or start over.</Trans>
            </FormError>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">
              <Trans>Code</Trans>
            </Label>
            <Input
              id="code"
              ref={codeRef}
              name="code"
              // The format is Zitadel configuration we do not own, so there is no shape rule —
              // only the browser affordances that make a mailed code easy to paste.
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
            />
          </div>
          <Button type="primary" theme="solid" htmlType="submit" block loading={submitting}>
            <Trans>Continue</Trans>
          </Button>
        </RRForm>
        <Link
          to={paths.recover.index({ requestId, organization })}
          className="text-foreground/60 text-xs underline">
          <Trans>Wrong address? Start over</Trans>
        </Link>
      </AuthCard>
    );
  }

  // ── the address form ────────────────────────────────────────────────────────────────────────
  return (
    <AuthCard
      branding={branding}
      title={<Trans>Recover your account</Trans>}
      description={
        <Trans>Enter your email address and we'll send you a link to set up a new passkey.</Trans>
      }>
      <RRForm
        method="POST"
        className="flex w-full flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit(emailRef, 'recovery');
        }}>
        <AuthFormFields csrf={csrfToken} requestId={requestId} organization={organization} />
        <input type="hidden" name="intent" value="request" />
        {actionData && 'error' in actionData && actionData.error === 'INVALID_INPUT' ? (
          <FormError>
            <Trans>Enter a valid email address.</Trans>
          </FormError>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">
            <Trans>Email</Trans>
          </Label>
          <Input
            id="email"
            ref={emailRef}
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={prefill.email}
            placeholder={t`you@example.com`}
            autoFocus
          />
        </div>
        <Button type="primary" theme="solid" htmlType="submit" block loading={submitting}>
          <Trans>Send recovery link</Trans>
        </Button>
      </RRForm>
    </AuthCard>
  );
}
