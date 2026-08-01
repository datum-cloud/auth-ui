import { IdpButtonList } from '@/components/auth-form/idp-button-list';
import { FormError } from '@/components/form-error/form-error';
import { WebAuthnReasonCopy } from '@/components/webauthn-button/webauthn-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { useLoginContext } from '@/hooks/use-login-context';
import { usePasskeyLoginCeremony } from '@/hooks/use-passkey-login-ceremony';
import SplitLayout from '@/layouts/split.layout';
import { listSessions, readSessions } from '@/modules/auth/session/cookie';
import {
  idpAutostartMatches,
  readIdpAutostart,
  serializeIdpAutostart,
} from '@/modules/auth/session/idp-autostart';
import { startIdpIntent } from '@/resources/login';
import { loginIdpSchema } from '@/resources/login/login.schema';
import {
  GHOST_METHODS,
  isSoleLinkedIdp,
  resolveGhostPolicyOrg,
  resolveMethodOptions,
} from '@/resources/login/method-options';
import { readCeremonyParams } from '@/resources/shared/ceremony-params';
import { resolveOrg, resolvePolicyOrg } from '@/resources/shared/resolve-org';
import { joinLinkedIdps } from '@/resources/sso';
import { getActiveIdPs } from '@/resources/sso/idp-providers';
import { redirectToLogin } from '@/routes/login-bounce';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { trustedAppOrigin } from '@/server/infra/app-origin.server';
import { env } from '@/server/infra/env.server';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { cn } from '@datum-cloud/datum-ui/utils';
import { Trans } from '@lingui/react/macro';
import { Key, Lock, Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  data,
  redirect,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Choose how to sign in' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const { loginName, requestId, organization } = readCeremonyParams(new URL(request.url));
  const bounce = () => redirect(redirectToLogin(requestId, organization));

  if (!loginName) return bounce();

  // ── SESSION GATE ────────────────────────────────────────────────────────────────────────
  // This loader is state-changing (it mints a real Zitadel IdP intent for a sole-linked-IdP
  // account and 302s to the provider) and its outcomes are distinguishable from outside:
  // 302-to-a-named-provider (sole IdP) vs 200 (several methods) vs 302-to-/verify|/error (none).
  // Before the gate an unknown identifier added a fourth, 302-to-/login. Reachable by URL alone
  // that made
  // `GET /id/login/method?loginName=X` an account-existence AND identity-provider oracle, a
  // login-CSRF vector (no token on a GET), and a bypass of ignoreUnknownUsernames — which is
  // honoured only in resolveIdentifier (login.service.ts).
  //
  // Requiring the ceremony session the identifier step ALREADY planted for this loginName costs
  // legitimate arrivals nothing: /login's identifier action serializes `result.sessions` into the
  // cookie on the same response that redirects here, and every other path to this URL (the e2e
  // helper's chooser hop, a Back from a later step, a reload) carries that same cookie.
  //
  // WHAT THIS GATE IS AND IS NOT. It is NOT an authorization boundary: the cookie it demands is
  // SELF-ISSUABLE — any party can POST /id/login (CSRF-protected, so not forceable cross-site,
  // but self-driven probing only needs to fetch the token first) and be handed one. So the gate
  // raises the cost of reaching this loader by exactly one request; what actually bounds
  // enumeration BREADTH is the two-tier GET limiter in server/middleware/rate-limit.ts, now
  // backed by an ip ceiling on the identifier POST itself. What the gate genuinely buys is that
  // `GET /id/login/method?loginName=X` alone — with no cookie at all — mints nothing and tells
  // nobody anything, which is what makes the URL safe to hand out, bookmark and reload.
  //
  // NOT-KNOWN-EXPIRED, not "live": listSessions is the codebase's expiry-aware filter (the same
  // idiom arm-login-passkey.ts uses) but it deliberately KEEPS entries whose expirationTs is
  // empty or unparseable (session.ts) — and Zitadel Session-API sessions minted without an
  // explicit lifetime, which is exactly what the ceremony createSession produces, carry no
  // expirationDate. So a known-expired entry cannot pass, but an unknown-expiry one can.
  // Case-insensitive: the URL carries the provider's canonical loginName while a hand-typed or
  // IdP-returned identifier may differ in case.
  const sessions = listSessions(await readSessions(request), Date.now());
  if (!sessions.some((s) => s.loginName.toLowerCase() === loginName.toLowerCase())) {
    return bounce();
  }

  // ── GHOST SUBJECT (anti-enumeration) ────────────────────────────────────────────────────
  // A findUser MISS here does NOT mean "no such account, bounce". `ignoreUnknownUsernames` makes
  // /login's identifier step plant a real ceremony session for an UNKNOWN identifier and route it
  // to THIS url — the same one a real password-only account is routed to — precisely so the two
  // are indistinguishable. Bouncing on the miss would hand that difference straight back: a
  // 302-to-/login for the unknown vs a 200 chooser for the known is a perfect existence oracle,
  // and it would silently disable a security setting the tenant switched on.
  //
  // So a miss that CLEARED THE SESSION GATE above is served the password-only chooser (see
  // GHOST_METHODS): same status, same single control, same branding resolution, same rotated CSRF
  // token, same headers. Its Password link leads to /login/password, where the ghost session's
  // credential check fails generically — exactly as it did before this route existed.
  //
  // The gate is what makes this safe to serve at all: the ONLY way to reach it is a live ceremony
  // session this browser was handed for this loginName, which /login mints only under the flag.
  const user = await provider.findUser(loginName, organization);

  // The method chooser is a branded screen — thread getBranding through so SplitLayout
  // renders the org logo, mirroring /login and /signup. Fetched in parallel with the rest.
  // Org-first: an explicit org wins, else the default org (matches the old app's
  // `organization ?? getDefaultOrg()`). findUser above stays instance-wide by design.
  const brandingOrg = await resolveOrg(provider, organization);
  // POLICY reads (login settings + the org's active IdPs) must resolve to the SAME org
  // resolveIdentifier used when it routed the user here. Both sides now call resolvePolicyOrg,
  // so that agreement is structural rather than two look-alike expressions kept in sync by hand
  // (they previously diverged for a user with NO orgId: instance settings there, default-org
  // settings here). Branding is deliberately left org-first — the logo follows the ceremony's
  // org, not the user's. Sequenced after brandingOrg so the memoized default-org lookup is
  // already warm and this costs no second provider round-trip.
  // A GHOST has no orgId for resolvePolicyOrg's middle rung to bite on, so this used to fall
  // through to the DEFAULT org while a real account at the same address was judged by its own.
  // That split `available` — and with it the render-vs-/error outcome — between the two branches,
  // re-opening the existence oracle one hop after resolveIdentifier closed it. Both hops now
  // resolve a ghost's policy org from the identifier's domain (see resolveGhostPolicyOrg), so the
  // decision that routed the subject here and the one recomputed here read the same org either way.
  const settingsOrg = user
    ? await resolvePolicyOrg(provider, organization, user.orgId)
    : await resolveGhostPolicyOrg(provider, organization, loginName);
  const [methods, settings, branding, { csrfToken, headers }] = await Promise.all([
    // A ghost has no id to enumerate methods for; it carries the synthesized password-only
    // enrolment instead, and every read below is the one a real account makes.
    user ? provider.listAuthMethods(user.id) : Promise.resolve([...GHOST_METHODS]),
    provider.getLoginSettings(settingsOrg),
    provider.getBranding(brandingOrg),
    loaderCsrf(request),
  ]);

  // Which methods this account can actually use right now (same policy gates as
  // decideAfterIdentifier, plus the linked-IdP resolution that function cannot see).
  // This screen is the destination for EVERY account with >= 1 available method.
  const { available, idps } = await resolveMethodOptions(provider, {
    // Never read for a ghost: GHOST_METHODS carries no 'idp', so the linked-provider join
    // (the only place userId is used) does not run.
    userId: user?.id ?? '',
    methods,
    settings,
    policyOrg: settingsOrg,
    emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
  });

  // Sole linked IdP: start the intent here rather than rendering a one-button screen.
  // Server-side, so the chooser never renders and the user sees no intermediate page.
  //
  // ONE-SHOT. Being in a LOADER is what buys the no-flash redirect, and it is also what makes
  // this dangerous: a loader re-runs on every arrival at the URL, including the one the browser
  // makes when the user presses Back at the provider. Unguarded, that Back mints a NEW Zitadel
  // intent and bounces them forward again — they can never get back into the app. The marker
  // cookie makes the second arrival for the same loginName fall through and RENDER the chooser,
  // whose IdP button restarts the ceremony deliberately (a POST to this route's action, where
  // Back does not re-fire — which is also why /login's domain-discovery branch, an action, never
  // needed a guard like this one).
  if (isSoleLinkedIdp({ available, idps })) {
    const alreadyAutoStarted = idpAutostartMatches(await readIdpAutostart(request), loginName);
    if (!alreadyAutoStarted) {
      const idpResult = await startIdpIntent(provider, {
        idpId: idps[0].id,
        origin: trustedAppOrigin(request),
        requestId,
        organization,
        // The IdP was picked out of a list resolved for settingsOrg; the callback must gate
        // allowRegister in that same org rather than in whatever `organization` resolves to.
        policyOrg: settingsOrg,
        reauthHint: loginName,
      });
      // On failure fall through and render the button, so the user keeps a way forward.
      // The marker is written only on the redirect that actually mints — a failed start has
      // nothing to come Back from.
      if (idpResult.ok) {
        return redirect(idpResult.authUrl, {
          headers: { 'set-cookie': await serializeIdpAutostart(loginName) },
        });
      }
    }
  }

  // Nothing usable. Exactly two outcomes are reachable from here, so name them directly
  // rather than asking decideAfterIdentifier and filtering its answer: no enrolled methods
  // at all is the invite path (/verify); anything else is a policy dead end (/error — the
  // PASSWORD_NOT_ALLOWED / NO_SUPPORTED_METHOD legs, which carry no params of their own).
  //
  // A GHOST reaches this only where a real password-only account would: its synthesized
  // enrolment is non-empty, so an org that forbids passwords sends both to /error, and neither
  // can reach the /verify leg. (In practice resolveIdentifier already sent both there — this is
  // the direct-URL arrival with a still-live session.)
  //
  // Deciding it here is what makes a self-redirect loop UNREPRESENTABLE. decideAfterIdentifier
  // counts 'idp' as available from methods.includes('idp') && settings.allowExternalIdp alone
  // — it has no visibility into the resolved `idps` list above, which is the ONLY source of
  // truth this route has for actually-usable linked IdPs. A user whose sole enrolled method is
  // 'idp' but whose links are all missing, inactive, or LDAP-only lands here (our own
  // `available` is []) while that function still names THIS route. Following it would 302 into
  // ourselves forever (same user, same inputs, same empty `available` every time); neither
  // destination below can name /login/method, so there is nothing left to guard against.
  if (available.length === 0) {
    // Same query the manual URLSearchParams built (loginName, then requestId, then
    // organization; undefined values skipped) — paths.* threads the ceremony for us.
    const query = { loginName, requestId, organization };
    return redirect(methods.length === 0 ? paths.verify.index(query) : paths.error(query));
  }

  return data(
    { loginName, requestId, organization, methods: available, branding, idps, csrfToken },
    { headers }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = loginIdpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
  const { idpId, requestId, organization } = parsed.data;

  const { loginName } = readCeremonyParams(new URL(request.url));
  if (!loginName) return redirect(redirectToLogin(requestId, organization));

  const user = await provider.findUser(loginName, organization);
  // This action is unauthenticated (driven by the loginName ceremony param, not a session).
  // "Unknown user" and "known user, idp not linked" must return the IDENTICAL response —
  // previously the former redirected to /login while the latter returned this 400, making the
  // action a linked-IdP identity oracle (redirect vs 400 vs the eventual 302-to-provider on
  // success let an attacker probe both account existence and which IdP a given address uses).
  if (!user) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  // Defensive server-side re-check: never trust the client's idpId — confirm it
  // resolves to one of THIS identified user's own linked, active, non-LDAP providers
  // before starting the round-trip. Mirrors the same check reauth.tsx's idp-reauth
  // action uses for its own linked-IdP chooser.
  //
  // Resolved through the SAME helper the loader uses, for the same reason: this check must
  // accept precisely the set of buttons the loader rendered. Reading a different org's active
  // IdPs here would 400 a legitimate click on a provider the loader itself just offered.
  const settingsOrg = await resolvePolicyOrg(provider, organization, user.orgId);
  const [links, active] = await Promise.all([
    provider.listIdpLinks(user.id),
    getActiveIdPs(provider, settingsOrg),
  ]);
  const isLinked = joinLinkedIdps(links, active).some(
    (l) => l.idpId === idpId && l.type !== 'LDAP'
  );
  if (!isLinked) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const result = await startIdpIntent(provider, {
    idpId,
    origin: trustedAppOrigin(request),
    requestId,
    organization,
    // Same divergence the loader's auto-start closes: the button was offered from settingsOrg's
    // IdP list, so the callback must gate allowRegister in settingsOrg too.
    policyOrg: settingsOrg,
    reauthHint: loginName,
  });
  if (!result.ok) return data({ error: result.error }, { status: 502 });
  return redirect(result.authUrl);
}

// This loader MINTS CEREMONY STATE — a Zitadel IdP intent for a sole-linked-IdP account, a
// rotated loaderCsrf token, the one-shot auto-start marker — and costs ~5 provider reads plus a
// rate-limit unit per run. The in-place passkey ceremony below submits its assertion to
// /login/passkey while THIS route stays mounted, and RR's default post-submit revalidation would
// re-run all of that on every ceremony step. Same guard, same marker, and the same WEBAU-3M9si
// class of hazard as login/index.tsx:284 and /login/passkey:40. Anything else revalidates normally.
export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: {
  formData?: FormData;
  defaultShouldRevalidate: boolean;
}) {
  if (formData?.get('passkeyCeremony') === '1') return false;
  return defaultShouldRevalidate;
}

export default function LoginMethod() {
  const { methods, branding, idps, csrfToken } = useLoaderData<typeof loader>();
  const { loginName, requestId, organization } = useLoginContext();

  // Typed paths.* emit the identical query string buildParams produced
  // (loginName, then requestId, then organization — undefined values are skipped).
  const query = { loginName, requestId, organization };

  const ceremony = usePasskeyLoginCeremony({ loginName, requestId, organization });
  const serverError = useAuthActionError(ceremony.actionData);
  const passkeyBusy = ceremony.phase !== 'idle';

  // Sole passkey: the identifier step already captured intent, so run the ceremony on
  // arrival instead of rendering a one-button screen. One-shot — a cancelled ceremony
  // must leave the button usable rather than re-prompting in a loop.
  const solePasskey = methods.length === 1 && methods[0] === 'passkey';
  const autoBegunRef = useRef(false);
  // The auto-begun attempt has no transient user activation behind it (no click preceded the
  // mount), and WebKit REQUIRES activation for navigator.credentials.get() — so on Safari it
  // reliably rejects with NotAllowedError, which the ceremony classifies as 'not-allowed'.
  // That reason's copy tells the user their passkey sign-in "was cancelled", accusing someone
  // who has done nothing but arrive. Suppress the copy for THIS attempt only; the Passkey
  // button below stays as the way forward, and a ceremony the user starts by clicking reports
  // its failure exactly as it does on every other surface.
  const [suppressAutoBeginReason, setSuppressAutoBeginReason] = useState(false);
  useEffect(() => {
    if (!solePasskey || autoBegunRef.current) return;
    autoBegunRef.current = true;
    setSuppressAutoBeginReason(true);
    ceremony.begin();
  }, [solePasskey, ceremony]);

  // Any user-initiated ceremony re-arms the copy — begin() clears the previous reason, so the
  // next one to land belongs to an attempt the user asked for.
  const beginFromClick = () => {
    setSuppressAutoBeginReason(false);
    ceremony.begin();
  };
  const ceremonyReason = suppressAutoBeginReason ? null : ceremony.reason;

  // Mirrors login/index.tsx's own submittingIdpId computation — drives IdpButtonList's
  // per-row loading state while its POST to this route's own action is in flight.
  const navigation = useNavigation();
  const submittingIdpId =
    navigation.state !== 'idle' && navigation.formData?.get('intent') === 'idp'
      ? String(navigation.formData.get('idpId') ?? '')
      : null;

  return (
    <SplitLayout branding={branding}>
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-foreground text-2xl leading-6 font-semibold">
          <Trans>Choose how to sign in</Trans>
        </h1>
        <p className="text-foreground/80 text-sm">
          <Trans>
            Signing in as <span className="font-medium">{loginName}</span>.
          </Trans>{' '}
          <Link
            to={paths.login.index({ requestId, organization })}
            className="text-foreground underline underline-offset-4">
            <Trans>Not you?</Trans>
          </Link>
        </p>
        {ceremonyReason ? (
          <FormError>
            <WebAuthnReasonCopy reason={ceremonyReason} />
          </FormError>
        ) : serverError ? (
          <FormError>{serverError}</FormError>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {methods.includes('passkey') ? (
          // A REAL <a> to /login/passkey that JS upgrades in place. Hydrated, the click is
          // intercepted and the ceremony runs HERE (lazy challenge; a password pick never spends
          // a session) with the list still visible as the fallback on failure. UNHYDRATED, the
          // browser simply follows the href to the standalone passkey screen — which is exactly
          // where a sole-passkey account was routed before this chooser existed. It was a
          // <Button htmlType="button"> until that combination dead-ended those users completely:
          // with passkey as the only method it is the only control on the page, and without
          // hydration nothing happened at all. Same convention as the Password entry below.
          <LinkButton
            size="large"
            className={cn('h-13 gap-3', passkeyBusy && 'pointer-events-none opacity-50')}
            type="quaternary"
            theme="outline"
            block
            as={Link}
            href={paths.login.passkey(query)}
            aria-disabled={passkeyBusy}
            aria-busy={passkeyBusy}
            onClick={(e) => {
              if (passkeyBusy) {
                e.preventDefault();
                return;
              }
              // Hydrated: stay put and run the ceremony in place. Unhydrated this handler never
              // runs and the href is followed instead.
              e.preventDefault();
              beginFromClick();
            }}
            iconPosition="left"
            icon={<Icon icon={Key} />}>
            <Trans>Passkey</Trans>
          </LinkButton>
        ) : null}

        {methods.includes('otp_email') ? (
          <LinkButton
            size="large"
            className={cn('h-13 gap-3', passkeyBusy && 'pointer-events-none opacity-50')}
            type="quaternary"
            theme="outline"
            block
            as={Link}
            href={paths.login.verify.email(query)}
            aria-disabled={passkeyBusy}
            onClick={(e) => passkeyBusy && e.preventDefault()}
            iconPosition="left"
            icon={<Icon icon={Mail} />}>
            <Trans>Email me a sign-in link</Trans>
          </LinkButton>
        ) : null}

        {methods.includes('password') ? (
          <LinkButton
            size="large"
            className={cn('h-13 gap-3', passkeyBusy && 'pointer-events-none opacity-50')}
            type="quaternary"
            theme="outline"
            block
            as={Link}
            href={paths.login.password(query)}
            aria-disabled={passkeyBusy}
            onClick={(e) => passkeyBusy && e.preventDefault()}
            iconPosition="left"
            icon={<Icon icon={Lock} />}>
            <Trans>Password</Trans>
          </LinkButton>
        ) : null}

        {methods.includes('idp') ? (
          <IdpButtonList
            idps={idps}
            csrf={csrfToken}
            requestId={requestId}
            organization={organization}
            submittingIdpId={submittingIdpId}
            disabled={passkeyBusy}
          />
        ) : null}
      </div>
    </SplitLayout>
  );
}
