import { SubmitButton } from '@/components/auth-form/auth-form';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { IdpButtonList } from '@/components/auth-form/idp-button-list';
import { OrDivider } from '@/components/auth-form/or-divider';
import { FormError } from '@/components/form-error/form-error';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import SplitLayout from '@/layouts/split.layout';
import { ProviderError } from '@/modules/auth/types';
import {
  MaxMindTracker,
  readMaxMindTrackingToken,
  syncMaxMindTokenToRef,
} from '@/modules/fraud/maxmind-tracker';
import { useRecaptcha } from '@/modules/fraud/recaptcha';
import { startIdpIntent } from '@/resources/login';
import { loginIdpSchema } from '@/resources/login/login.schema';
import { genericCheckYourEmail } from '@/resources/schemas/check-your-email.schema';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { completeSignupHandoff } from '@/resources/signup/complete-handoff';
import { registerPasskeySignup } from '@/resources/signup/passkey-signup';
import { placeholderNameFromEmail } from '@/resources/signup/placeholder-name';
import { decideSignupIdpIntent } from '@/resources/signup/signup-decision';
import { resolveSignupView } from '@/resources/signup/signup-view';
import { signupCodeSchema, signupIdentifierSchema } from '@/resources/signup/signup.schema';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { requireEmailVerification } from '@/server/env';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { recaptchaRejects } from '@/server/infra/recaptcha.server';
import { waitUntilDeadline } from '@/server/timing';
import { actionError } from '@/utils/errors/auth-error';
import { Button } from '@datum-cloud/datum-ui/button';
import { Form } from '@datum-cloud/datum-ui/form';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans, useLingui } from '@lingui/react/macro';
import { Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  data,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import {
  Form as RRForm,
  Link,
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Create account' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);
  const organization = url.searchParams.get('organization') ?? undefined;
  const requestId = url.searchParams.get('requestId') ?? undefined;

  // Org-first: an explicit org wins, else the default org (old app's `organization ?? getDefaultOrg()`).
  // The IdP list is a display read — like getLoginSettings/getBranding it uses the default-org
  // fallback, not the raw URL org (which is undefined on a bare signup).
  const settingsOrg = await resolveOrg(provider, organization);
  const [settings, branding, idps] = await Promise.all([
    provider.getLoginSettings(settingsOrg),
    provider.getBranding(settingsOrg),
    provider.capabilities.externalIdp ? provider.getActiveIdPs(settingsOrg) : Promise.resolve([]),
  ]);

  const { csrfToken, headers } = await loaderCsrf(request);

  // Phase 4 register-and-link: the IdP callback (/sso/:provider/callback) redirects a brand-new
  // IdP user here with the intent + draft so this screen can compose register → addIdpLink → createSession.
  // Keep this prefill so the downstream /signup/method can pick it up when needed.
  const idpIntentId = url.searchParams.get('idpIntentId') ?? undefined;
  const idp = idpIntentId
    ? {
        idpIntentId,
        idpIntentToken: url.searchParams.get('idpIntentToken') ?? '',
        idpId: url.searchParams.get('idpId') ?? '',
        idpUserId: url.searchParams.get('idpUserId') ?? '',
        idpUserName: url.searchParams.get('idpUserName') ?? '',
      }
    : undefined;

  const prefill = {
    email: url.searchParams.get('email') ?? '',
  };

  const view = resolveSignupView(
    settings,
    idps,
    env.AUTH_EMAIL_DELIVERY_ENABLED,
    requireEmailVerification()
  );

  return data(
    {
      csrfToken,
      branding,
      view,
      idps,
      organization,
      requestId,
      maxmindAccountId: env.MAXMIND_ACCOUNT_ID ?? '',
      recaptchaSiteKey: env.RECAPTCHA_SITE_KEY ?? '',
      prefill,
      idp,
    },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  // IdP branch — EXEMPT from the reCAPTCHA gate below, deliberately. It creates nothing, only
  // redirects; the account is created at GET /id/sso/:provider/callback, behind a real OAuth
  // round-trip a bot cannot forge. Pinned by recaptcha-gate.cy.ts.
  if (form.get('intent') === 'idp') {
    const parsed = loginIdpSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
    const { idpId, requestId, organization, deviceTrackingToken } = parsed.data;
    try {
      const result = await startIdpIntent(provider, {
        idpId,
        origin: trustedAppOrigin(request),
        requestId,
        organization,
        deviceTrackingToken,
      });
      // The pure decider maps the service result onto the Decision union.
      const decision = decideSignupIdpIntent(result);
      switch (decision.kind) {
        case 'redirect':
          return redirect(decision.path);
        case 'error':
          return data({ error: decision.error }, { status: 502 });
      }
    } catch (err) {
      return actionError(err);
    }
  }

  // Bot gate, before any Zitadel work so a rejection costs what an acceptance costs (G7).
  // Distinct action per intent, so an identifier token cannot be replayed against code entry.
  const recaptchaAction = form.get('intent') === 'code' ? 'signup_code' : 'signup';
  if (await recaptchaRejects(String(form.get('recaptchaToken') ?? ''), recaptchaAction)) {
    return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  }

  // Code branch — the emailed code, typed instead of clicked. Same secret as the link.
  if (form.get('intent') === 'code') {
    // t0 for the constant-time deadline below. Stamped at BRANCH ENTRY so every 400 this branch
    // can return leaves at the same mark, whichever path produced it.
    const startedAt = Date.now();
    const parsed = signupCodeSchema.safeParse(Object.fromEntries(form));

    // Every failure below re-renders the check-your-email TERMINAL carrying the error, not a bare
    // error: the code field exists only on that screen, so returning `{ error }` alone dropped the
    // user onto the empty identifier screen with their address gone and the message attached to
    // the wrong form — one typo ended the flow. `sent` is what selects the terminal, so it has to
    // be in the shape. The address is the one just submitted, so echoing it back reveals nothing.
    const identified = signupCodeSchema.pick({ email: true }).safeParse(Object.fromEntries(form));
    const invalidCode = () =>
      identified.success
        ? data(
            { sent: true as const, email: identified.data.email, error: 'INVALID_CODE' as const },
            { status: 400 }
          )
        : // No parseable address to render the terminal around (hand-crafted POST) — the generic
          // error is all that is left.
          data({ error: 'INVALID_CODE' as const }, { status: 400 });

    if (!parsed.success) return invalidCode();
    const { email, code, organization, requestId } = parsed.data;

    // Resolve the id SERVER-SIDE. The client never sends one: this screen also renders for an
    // address that already has an account, so an id in the page would reveal that it exists.
    // Safe to resolve here because a valid code already proves control of the inbox.
    // Org-scoped like every other findUser call site (password.service.ts, mfa.service.ts): the
    // org is already parsed here and threaded into completeSignupHandoff below, and an unscoped
    // lookup cannot see a user outside the default org — who then could never finish by code.
    const user = await provider.findUser(email, organization);
    // An unknown address answers exactly as a wrong code does, so neither reveals the other.
    // Both 400s wait for the SAME deadline (see waitUntilDeadline) rather than padding only the
    // not-found branch: a fixed floor on one side alone inverts the channel whenever the other
    // side is faster than the floor, which for a healthy provider is the common case.
    if (!user) {
      await waitUntilDeadline(startedAt);
      return invalidCode();
    }

    try {
      return await completeSignupHandoff(provider, request, {
        userId: user.id,
        code,
        loginName: user.loginName,
        organization,
        requestId,
        next: 'passkey',
      });
    } catch (err) {
      // A spent, wrong or expired code all arrive as a ProviderError, and Zitadel does not tell
      // them apart. One answer for all three; the copy hedges to match.
      if (err instanceof ProviderError) {
        await waitUntilDeadline(startedAt);
        return invalidCode();
      }
      throw err;
    }
  }

  // Identifier flow: collect email, derive the placeholder name, and REGISTER — sending the
  // verification mail from this action.
  //
  // This used to redirect to /signup/method, a screen whose only remaining job was to echo the
  // address back and offer one button. Signup is passkey-only, so that chooser had nothing to
  // choose: the derived firstName/lastName made a round-trip through the URL into hidden inputs
  // (user-editable in transit) purely to be posted straight back here. Registering inline keeps
  // the derived name server-side and puts the mail-send behind this route's IP rate limiter,
  // which /signup/method is not covered by (see server/middleware/rate-limit.ts).
  //
  // /signup/method is deliberately still live and unchanged — an in-flight tab mid-signup must
  // not break — it is simply no longer where this flow routes.
  const parsed = signupIdentifierSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const { email, organization, requestId } = parsed.data;
  // The placeholder name is derived here rather than via decideAfterSignupIdentifier: that
  // decider exists to produce a /signup/method REDIRECT, and the shared Decision union types
  // `params` as optional, so consuming it for a value would mean asserting past the type. The
  // derivation itself is the only part this flow needs, and placeholder-name.ts owns it.
  const { firstName, lastName } = placeholderNameFromEmail(email);

  // t0 for the same constant-time deadline the code branch uses. The two responses that MUST stay
  // indistinguishable here are fresh and squatted: both return the generic terminal below, but they
  // cost very different work — fresh is one register call, while squatted adds findUser,
  // listAuthMethods, the resend-rate check and usually a mail send. Without a shared deadline that
  // gap is an account-existence oracle, which is the one thing the generic response exists to deny.
  //
  // NOT applied to the ALREADY_EXISTS path below: disclosing an enrolled account is a deliberate
  // product decision (see signup.service.ts), so there is nothing left to hide about its latency.
  //
  // Bounded, like every deadline: it equalises only while the real work finishes inside the floor.
  // A resend that overruns it still leaves a measurable tail — the residual this flow has always
  // carried, recorded here rather than quietly dropped.
  const startedAt = Date.now();

  try {
    const result = await registerPasskeySignup(provider, {
      email,
      firstName,
      lastName,
      organization,
      requestId,
      origin: trustedAppOrigin(request),
    });
    if (!result) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
    await waitUntilDeadline(startedAt);
    return genericCheckYourEmail(result.email);
  } catch (err) {
    return actionError(err);
  }
}

export default function Signup() {
  const {
    csrfToken,
    branding,
    view,
    idps,
    organization,
    requestId,
    maxmindAccountId,
    recaptchaSiteKey,
    prefill,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useLingui();

  // Form.Root forwards no ref, so each form is located via an always-rendered hidden input's
  // `.form`. Not the recaptchaToken input — that one is conditional, and a null ref on an
  // unconfigured deployment would break every submit.
  const deviceTokenRef = useRef<HTMLInputElement>(null);
  const codeFormRef = useRef<HTMLInputElement>(null);

  // Best-effort only. The race-safe write happens at submit via syncMaxMindTokenToRef in
  // handleIdentifierSubmit; this interval may still be empty when the user submits.
  useEffect(() => {
    if (!maxmindAccountId) return;
    const sync = () => {
      const token = readMaxMindTrackingToken();
      if (token && deviceTokenRef.current) {
        deviceTokenRef.current.value = token;
        return true;
      }
      return false;
    };
    if (sync()) return;
    const handle = window.setInterval(() => {
      if (sync()) window.clearInterval(handle);
    }, 300);
    return () => window.clearInterval(handle);
  }, [maxmindAccountId]);

  // Loads the reCAPTCHA script (no-op when unconfigured) and returns the submit-time minter.
  // Each form passes its own action name — never shared between the two, see useRecaptcha.
  const mintRecaptchaToken = useRecaptcha(recaptchaSiteKey);

  // Interception happens on the form's submit EVENT, not a button onClick: each form has one
  // blocking field and so submits natively on Enter, which runs no onClick at all.
  const submit = useSubmit();

  // Guards the mint window, which `navigation.state` does not cover — it only flips once
  // submit() is called. Refs, not state, so check-and-set is synchronous.
  const identifierSubmitInFlight = useRef(false);
  const codeSubmitInFlight = useRef(false);
  const [identifierMinting, setIdentifierMinting] = useState(false);
  const [codeMinting, setCodeMinting] = useState(false);

  async function handleIdentifierSubmit() {
    if (identifierSubmitInFlight.current) return;
    identifierSubmitInFlight.current = true;
    setIdentifierMinting(true);
    try {
      syncMaxMindTokenToRef(deviceTokenRef);
      const formEl = deviceTokenRef.current?.form;
      if (!formEl) return;
      // Snapshot BEFORE the await: the conform adapter resets the form during this same submit
      // cycle, so a post-await DOM read can come back already cleared.
      const formData = new FormData(formEl);
      const token = await mintRecaptchaToken('signup');
      // Unconfigured deployments send no field at all, not just render none.
      if (recaptchaSiteKey) formData.set('recaptchaToken', token ?? '');
      submit(formData, { method: 'post' });
    } finally {
      identifierSubmitInFlight.current = false;
      setIdentifierMinting(false);
    }
  }

  async function handleCodeSubmit() {
    if (codeSubmitInFlight.current) return;
    codeSubmitInFlight.current = true;
    setCodeMinting(true);
    try {
      const formEl = codeFormRef.current?.form;
      if (!formEl) return;
      // Snapshot before the await — see handleIdentifierSubmit.
      const formData = new FormData(formEl);
      const token = await mintRecaptchaToken('signup_code');
      if (recaptchaSiteKey) formData.set('recaptchaToken', token ?? '');
      submit(formData, { method: 'post' });
    } finally {
      codeSubmitInFlight.current = false;
      setCodeMinting(false);
    }
  }

  // The action error surfaces INLINE via <FormError> (this replaces
  // the per-route toast); useAuthActionError owns the narrow→resolve pipeline.
  const errorMessage = useAuthActionError(actionData);

  const submittingIdpId =
    navigation.state !== 'idle' && navigation.formData?.get('intent') === 'idp'
      ? String(navigation.formData.get('idpId') ?? '')
      : null;

  const identifierSubmitting =
    navigation.state === 'submitting' && navigation.formData?.get('intent') !== 'idp';

  const [showEmailField, setShowEmailField] = useState(false);

  // Client-side schema for the email field (advisory; server re-validates).
  const emailClientSchema = signupIdentifierSchema.pick({ email: true });

  // Client-side schema for the emailed code. Picked down to `code` alone (min(1), same as the
  // server's signupCodeSchema) — Form.Field/Form.Input need a Form.Root ancestor to resolve field
  // state, but this schema enforces PRESENCE ONLY, matching the `required` attribute. No pattern,
  // length ceiling or case rule: the code's shape is Zitadel configuration this codebase does not
  // own (see signupCodeSchema's own comment).
  const codeClientSchema = signupCodeSchema.pick({ code: true });

  // Enumeration-safe terminal. The register action returns this SAME generic shape whether the
  // address was fresh or already had an account, so it must render here — previously this lived
  // on /signup/method, the screen the register call has moved off of.
  //
  // The address is echoed back in bold BECAUSE the confirmation step moved: a typo used to be
  // caught on the method screen ("Signing up as … Not you?") before anything was sent. Now the
  // mail goes out first, so this screen carries the check — and passwordless makes it matter, as
  // that mail IS the account and there is no password login to fall back on. "Start over" returns
  // to /signup with the address prefilled (index.tsx reads ?email) so a typo is a one-field edit,
  // not a retype.
  //
  // A rejected code returns this SAME shape plus `error`, so this branch stays first and the
  // terminal re-renders with the address intact and the message inline in the code form below —
  // a typo costs one retry, not the whole flow.
  if (actionData && 'sent' in actionData) {
    const sentEmail = (actionData as { email: string }).email;
    return (
      <SplitLayout branding={branding}>
        <div className="flex w-full flex-col gap-4">
          <h1 className="text-foreground text-2xl leading-6 font-semibold">
            <Trans>Check your email</Trans>
          </h1>
          <p className="text-foreground/80 text-sm">
            <Trans>
              We've sent a verification link to <strong>{sentEmail}</strong>. Open it on this device
              to finish setting up your passkey.
            </Trans>
          </p>

          {/* "on this device" is load-bearing, not decoration: the link creates the passkey
              wherever it is opened, so a user who clicks it on their phone ends up with the
              credential there while this tab is abandoned. The code is how they stay here. */}
          <Form.Root
            schema={codeClientSchema}
            formComponent={RRForm}
            method="POST"
            defaultValues={{ code: '' }}
            isSubmitting={navigation.state === 'submitting'}
            // Intercepts every submit trigger for this form — click, Enter, requestSubmit() —
            // not just a button's onClick. See handleCodeSubmit's comment above.
            onSubmit={handleCodeSubmit}
            className="flex w-full flex-col gap-2">
            <AuthFormFields csrf={csrfToken} requestId={requestId} organization={organization} />
            {/* Doubles as codeFormRef's anchor for locating this form from handleCodeSubmit —
                see that ref's declaration comment for why it is not the recaptchaToken input. */}
            <input type="hidden" name="intent" value="code" ref={codeFormRef} />
            <input type="hidden" name="email" value={sentEmail} />
            {/* Not ref'd — the mint is set on a FormData SNAPSHOT, never written back into this
                input's DOM value (see handleCodeSubmit's comment). Gated on recaptchaSiteKey:
                "unset config ⇒ feature entirely off" means no field either, not just no script
                and no verification. */}
            {recaptchaSiteKey ? (
              <input type="hidden" name="recaptchaToken" defaultValue="" />
            ) : null}
            <Form.Field name="code" label={t`Or enter the code from that email`} required>
              {/* The code's case is the server's business: the client must not alter it (see
                  signupCodeSchema). A touch keyboard would autocapitalise and autocorrect the
                  first characters anyway, silently mangling a code that turns out to permit
                  lowercase — so the keyboard hints are turned off explicitly. */}
              <Form.Input
                autoComplete="one-time-code"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-9"
              />
            </Form.Field>
            <FormError>{errorMessage}</FormError>
            <SubmitButton
              loading={codeMinting || navigation.state === 'submitting'}
              disabled={codeMinting}>
              <Trans>Continue</Trans>
            </SubmitButton>
          </Form.Root>

          <p className="text-foreground/80 text-sm">
            <Link
              to={paths.signup.index({
                requestId,
                organization,
                email: sentEmail,
              })}
              className="text-foreground underline underline-offset-4">
              <Trans>Wrong address? Start over</Trans>
            </Link>
          </p>

          {/* Shown UNCONDITIONALLY, which is the point.
              Submitting an address that already has an account returns this exact screen and
              sends no mail at all — runEnumerationSafeRegister answers ALREADY_EXISTS with the
              same generic 'sent' as a fresh address, and resendIfSquatted stays silent once the
              account has any auth method. That indistinguishability is the G7 gate (no account-
              existence oracle), so this screen must NOT hint at which case the user is in.
              What it CAN do is offer the door: a returning user who forgot they had an account
              would otherwise wait forever for a mail that is never coming. Rendering the link for
              everyone helps that user without telling anyone anything. */}
          <div className="border-border my-2 flex-grow border-t" />
          <p className="text-foreground/80 text-sm">
            <Trans>Already have an account?</Trans>{' '}
            <Link
              to={paths.login.index({ requestId, organization })}
              className="text-foreground underline underline-offset-4">
              <Trans>Sign in</Trans>
            </Link>
          </p>
        </div>
      </SplitLayout>
    );
  }

  return (
    <>
      <MaxMindTracker accountId={maxmindAccountId} />
      <SplitLayout branding={branding}>
        <div className="mb-8 flex flex-col gap-3">
          <h1 className="text-foreground text-2xl leading-6 font-semibold">
            <Trans>Get started</Trans>
          </h1>
          <p className="text-foreground/80 text-sm">
            <Trans>Create a new account</Trans>
          </p>
        </div>

        {view.signupUnavailable ? (
          <p className="text-foreground text-center text-sm">
            <Trans>Registration is currently unavailable. Please contact your administrator.</Trans>
          </p>
        ) : (
          <>
            {view.showIdpButtons ? (
              <IdpButtonList
                idps={idps}
                csrf={csrfToken}
                requestId={requestId}
                organization={organization}
                submittingIdpId={submittingIdpId}
              />
            ) : null}

            {view.showIdpButtons && view.allowEmailEntry ? <OrDivider /> : null}

            {view.allowEmailEntry ? (
              <>
                {!showEmailField ? (
                  <Button
                    size="large"
                    className="h-13 gap-3"
                    type="quaternary"
                    theme="outline"
                    block
                    iconPosition="left"
                    icon={<Icon icon={Mail} />}
                    onClick={() => setShowEmailField(true)}>
                    <Trans>Email</Trans>
                  </Button>
                ) : (
                  <Form.Root
                    schema={emailClientSchema}
                    formComponent={RRForm}
                    method="POST"
                    defaultValues={{ email: prefill.email }}
                    isSubmitting={navigation.state === 'submitting'}
                    // Intercepts every submit trigger for this form — click, Enter,
                    // requestSubmit() — not just a button's onClick. See handleIdentifierSubmit's
                    // comment above.
                    onSubmit={handleIdentifierSubmit}
                    className="flex w-full flex-col gap-4">
                    <AuthFormFields
                      csrf={csrfToken}
                      requestId={requestId}
                      organization={organization}
                    />
                    {/* deviceTrackingToken is populated client-side via ref (MaxMind mirror),
                        so it stays a route-local ref'd input outside the AuthFormFields cluster. */}
                    <input
                      type="hidden"
                      name="deviceTrackingToken"
                      ref={deviceTokenRef}
                      defaultValue=""
                    />
                    {/* Not ref'd — the mint is set on a FormData snapshot, never written back
                        into this input's DOM value (see handleIdentifierSubmit's comment).
                        Gated on recaptchaSiteKey: "unset config ⇒ feature entirely off" means
                        no field either, not just no script and no verification. */}
                    {recaptchaSiteKey ? (
                      <input type="hidden" name="recaptchaToken" defaultValue="" />
                    ) : null}
                    <Form.Field
                      name="email"
                      label={t`Email`}
                      required
                      labelClassName="text-xs"
                      className="mb-0">
                      <Form.Input
                        type="email"
                        autoFocus
                        autoComplete="email"
                        placeholder="email@example.com"
                        className="h-9"
                      />
                    </Form.Field>
                    <FormError>{errorMessage}</FormError>
                    <SubmitButton
                      loading={identifierMinting || identifierSubmitting}
                      disabled={identifierMinting}>
                      <Trans>Continue</Trans>
                    </SubmitButton>
                  </Form.Root>
                )}
              </>
            ) : null}

            {!view.allowEmailEntry && view.showIdpButtons ? (
              <FormError>{errorMessage}</FormError>
            ) : null}
          </>
        )}

        <div className="border-border my-8 flex-grow border-t" />
        <p className="text-foreground/80 text-center text-sm">
          <Trans>Already have an account?</Trans>{' '}
          <Link to={paths.login.index({ requestId, organization })} className="underline">
            <Trans>Sign in</Trans>
          </Link>
        </p>
      </SplitLayout>
    </>
  );
}
