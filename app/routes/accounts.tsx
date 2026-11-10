import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { IdpIcon } from '@/components/idp-icon/idp-icon';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { inferIdpType } from '@/modules/auth/idp-detect';
import { isAllowedRequestId, normalizeRequestId } from '@/resources/authorize';
import { userCodeSchema } from '@/resources/schemas/user-code';
import {
  listAccounts,
  resolveAccountAction,
  accountActionOutcomeToResponse,
} from '@/resources/session';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { loaderCsrf, assertCsrf } from '@/server/csrf';
import { Badge } from '@datum-cloud/datum-ui/badge';
import { Button, LinkButton } from '@datum-cloud/datum-ui/button';
import { Dialog } from '@datum-cloud/datum-ui/dialog';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans, useLingui } from '@lingui/react/macro';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  data,
  redirect,
  useLoaderData,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
  Form as RRForm,
  Link,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Choose an account' }];

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const accounts = await listAccounts(provider, request);

  // Thread the CURRENT ceremony requestId (a mid-OIDC/SAML/device account switch reaches the
  // picker at /accounts?requestId=…). Only an allowlisted (oidc_/saml_/device_) id is carried;
  // anything else is treated as absent so a switch/remove never reflects an arbitrary value.
  //
  // normalizeRequestId also folds Zitadel's RAW param shapes (?authRequest= → oidc_<id>,
  // ?samlRequest= → saml_<id>) into the same value, preferring an already-threaded requestId.
  // Without it a ceremony arriving raw — e.g. the legacy /ui/v2/login/accounts?authRequest=…
  // 301, which preserves the query verbatim — went undetected, so the picker rendered its
  // empty state and "Add an account" dropped the ceremony.
  const url = new URL(request.url);
  const candidate = normalizeRequestId(url);
  const requestId = isAllowedRequestId(candidate) ? candidate : null;
  // Thread the CURRENT ceremony organization alongside requestId — the loader previously never
  // read it, so a mid-ceremony org scope silently dropped off "Add an account" and the
  // switch/remove forms (regression: an org-scoped ceremony resumes org-less after /accounts).
  const organization = url.searchParams.get('organization') ?? undefined;
  // Device-grant "change account": the stable user_code carries the device context so a switch
  // returns to /device/authorize (consent) with the now-active account, and "add account" logs
  // in for that device grant.
  // Validate against the OAuth device user_code shape BEFORE it can reach a redirect target.
  // switchSchema/removeSchema already bound it for the action path; the loader is the third
  // consumer and the only one that now feeds an automatic 302 rather than a link a human clicks.
  const parsedUserCode = userCodeSchema.safeParse(url.searchParams.get('user_code') ?? undefined);
  const userCode = parsedUserCode.success ? (parsedUserCode.data ?? null) : null;
  // Re-auth landed here because the account that authenticated differs from the one being
  // re-authenticated (see reauthRedirect / the login + IdP identity guards). Surface a banner so
  // the user knows both accounts are kept and they should pick how to continue.
  const reauthMismatch = url.searchParams.get('reauthMismatch') === '1';

  // An empty picker mid-ceremony is a dead end: there is nothing to select and the only
  // control is "Add an account". Bounce straight to the identifier screen, carrying the
  // ceremony so login resumes the OIDC/SAML/device callback instead of falling through to
  // the default post-login redirect.
  //
  // Scoped to ceremony-present on purpose. A BARE empty /accounts still renders the empty
  // state — that is the correct answer for a logout probe, a bookmark, or the legacy
  // /ui/v2/login/accounts 301, and acceptance/logout.acceptance.cy.ts depends on it as a
  // security assertion (a signed-out session must not resolve to /signed-in).
  //
  // Placed BEFORE loaderCsrf so a discarded token is never minted. reauthMismatch cannot
  // co-occur with an empty list (both accounts are deliberately kept), and if it somehow
  // did, its "choose an account" banner is meaningless with zero accounts.
  if (accounts.length === 0 && (requestId || userCode)) {
    return redirect(addAccountHref({ requestId, organization, userCode }));
  }

  const { csrfToken, headers } = await loaderCsrf(request);

  return data(
    { csrfToken, accounts, requestId, organization, userCode, reauthMismatch },
    { headers }
  );
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form);

  const provider = providerForRequest(request);
  const outcome = await resolveAccountAction(provider, request, form);
  return accountActionOutcomeToResponse(outcome);
}

/**
 * The "add another account" target, shared by the component's link and the loader's
 * empty-picker redirect so the two can never drift apart.
 *
 * In the device-grant "change account" sub-flow (userCode set) log in for that device grant
 * (device_<userCode>) so the fresh account auto-authorizes the device; otherwise carry the
 * current ceremony requestId/organization (or nothing for a standalone add).
 * paths.login.index skips undefined values, so passing organization unconditionally is safe
 * even when it's absent.
 */
export function addAccountHref({
  requestId,
  organization,
  userCode,
}: {
  requestId: string | null;
  organization: string | undefined;
  userCode: string | null;
}): string {
  // add=1 marks an EXPLICIT "different account" intent: the /login loader suppresses the
  // usernameless fast path so the previously remembered user's passkey is never offered
  // to someone who asked to add another account.
  return userCode
    ? paths.login.index({ requestId: `device_${userCode}`, organization, add: '1' })
    : paths.login.index({ requestId: requestId ?? undefined, organization, add: '1' });
}

// ─── Component ───────────────────────────────────────────────────────────────

interface RemoveAccountDialogProps {
  sessionId: string;
  /** Display name, else login name — names the account in the trigger label and the dialog. */
  accountLabel: string;
  csrfToken: string;
  requestId: string | undefined;
  organization: string | undefined;
  userCode: string | null;
}

/**
 * Confirm-before-remove dialog for one account row. The destructive submit lives inside the
 * dialog so a stray click on the trash icon can't sign an account out (mirrors the passkeys
 * RemoveConfirmDialog). The remove form keeps the same hidden fields it had as an inline form.
 */
function RemoveAccountDialog({
  sessionId,
  accountLabel,
  csrfToken,
  requestId,
  organization,
  userCode,
}: RemoveAccountDialogProps) {
  const [open, setOpen] = useState(false);
  const actionData = useActionData();
  const navigation = useNavigation();
  const { t } = useLingui();
  // Scoped to THIS row: useNavigation is global and every account row renders its own dialog —
  // matching on sessionId keeps one row's removal from spinning all of them.
  const removing =
    navigation.state !== 'idle' &&
    navigation.formData?.get('intent') === 'remove' &&
    navigation.formData?.get('sessionId') === sessionId;
  // Close when an action result lands, so an inline error is not hidden behind the overlay.
  useEffect(() => {
    if (actionData !== undefined) setOpen(false);
  }, [actionData]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          size="xs"
          theme="link"
          type="danger"
          htmlType="button"
          className="text-destructive p-0"
          aria-label={t`Remove ${accountLabel}`}
          title={t`Remove ${accountLabel}`}>
          <Icon icon={Trash2} size={16} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header
          title={<Trans>Remove this account?</Trans>}
          description={
            <Trans>
              "{accountLabel}" will be signed out on this device. You can sign in again at any time.
            </Trans>
          }
        />
        <Dialog.Footer>
          <Button
            type="secondary"
            theme="outline"
            htmlType="button"
            disabled={removing}
            onClick={() => setOpen(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <RRForm method="POST">
            {/* Preserve the ceremony id on the post-remove redirect back to /accounts. */}
            <AuthFormFields csrf={csrfToken} requestId={requestId} organization={organization} />
            <input type="hidden" name="intent" value="remove" />
            <input type="hidden" name="sessionId" value={sessionId} />
            {/* Device "change account": keep the device context after a mid-flow remove. */}
            {userCode ? <input type="hidden" name="userCode" value={userCode} /> : null}
            <Button type="danger" theme="solid" htmlType="submit" loading={removing}>
              <Trans>Remove account</Trans>
            </Button>
          </RRForm>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export default function AccountPicker() {
  const { csrfToken, accounts, requestId, organization, userCode, reauthMismatch } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  // Inline-only error surface: the action error renders in a <FormError> (role="alert")
  // banner near the top of the accounts content — no toast.
  const errorMessage = useAuthActionError(actionData);

  const addAccountTarget = addAccountHref({ requestId, organization, userCode });

  return (
    <AuthCard
      title={<Trans>Choose an account</Trans>}
      description={<Trans>Select an account to continue or add a new one.</Trans>}
      className="max-w-[450px]">
      <div className="flex flex-col gap-3">
        {reauthMismatch ? (
          <p
            role="status"
            className="bg-muted/50 text-muted-foreground rounded-lg px-3 py-2 text-center text-sm">
            <Trans>
              You signed in as a different account than the one you were re-authenticating. Both are
              kept — choose an account to continue.
            </Trans>
          </p>
        ) : null}
        <FormError>{errorMessage}</FormError>
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-muted-foreground text-center text-sm">
              <Trans>No signed-in accounts.</Trans>
            </p>
            {/* LinkButton (single styled <a>) — NOT Button asChild, which emits
                <button><a> (nested-interactive axe violation in the prod build). */}
            {/* Carry the ceremony requestId so a fresh "add account" login resumes the
                OIDC/SAML/device callback (like the switch form) rather than dead-ending at
                the default post-login redirect. */}
            <LinkButton theme="link" type="quaternary" as={Link} href={addAccountTarget}>
              <Trans>Add an account</Trans>
            </LinkButton>
          </div>
        ) : (
          <>
            {/* Each row is itself the SWITCH target: the row-level <button type=submit> wraps
                the account info. The remove control is a SEPARATE sibling (a confirm dialog that
                owns its own form) — never nested inside the switch button — so there are no
                nested interactives (the prod a11y build rejects <button><button>/<button><a>). */}
            {accounts.map((account) => (
              <div key={account.sessionId} className="flex items-stretch gap-2 rounded-lg border">
                {/* Switch form: the whole account-info area is the submit control. */}
                <RRForm method="POST" className="min-w-0 flex-1">
                  {/* AuthFormFields carries csrf + the CURRENT ceremony id (requestId) so a
                      mid-OIDC/SAML/device switch resolves back into the protocol callback
                      instead of a terminal /signed-in page. requestId is null when no ceremony
                      is active → coerced to undefined so the hidden input is omitted. */}
                  <AuthFormFields
                    csrf={csrfToken}
                    requestId={requestId ?? undefined}
                    organization={organization}
                  />
                  <input type="hidden" name="intent" value="switch" />
                  <input type="hidden" name="sessionId" value={account.sessionId} />
                  {/* Device "change account": return to /device/authorize consent after switch. */}
                  {userCode ? <input type="hidden" name="userCode" value={userCode} /> : null}
                  <button
                    type="submit"
                    className="hover:bg-muted/50 focus-visible:ring-ring flex w-full items-center gap-2 rounded-l-lg p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none">
                    {/* idpType is absent for deactivated/unknown providers; recover GITHUB from a
                        handle-shaped loginName so it doesn't fall back to the mail glyph. */}
                    <IdpIcon
                      type={account.idpType ?? inferIdpType(account.loginName)}
                      name={account.displayName ?? account.loginName}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {account.displayName ?? account.loginName}
                        </span>
                        {account.idpName ? (
                          <Badge type="quaternary" theme="light" className="shrink-0 text-xs">
                            {account.idpName}
                          </Badge>
                        ) : null}
                      </span>
                      <span
                        className={`mt-0.5 text-xs ${account.isActive ? 'text-muted-foreground' : 'text-destructive/80'}`}>
                        {account.isActive ? (
                          <Trans>Session active</Trans>
                        ) : (
                          <Trans>Needs re-authentication</Trans>
                        )}
                      </span>
                    </span>
                  </button>
                </RRForm>

                {/* Remove control — sibling, NOT nested in the switch button. */}
                <div className="flex shrink-0 items-center pr-2">
                  <RemoveAccountDialog
                    sessionId={account.sessionId}
                    accountLabel={account.displayName ?? account.loginName}
                    csrfToken={csrfToken}
                    requestId={requestId ?? undefined}
                    organization={organization}
                    userCode={userCode}
                  />
                </div>
              </div>
            ))}

            {/* Same as the switch form: thread the ceremony requestId so a brand-new account's
                login resumes the OIDC/SAML/device callback (→ datumctl) instead of falling
                through to the default post-login redirect (cloud portal). */}
            <LinkButton
              theme="link"
              type="quaternary"
              className="text-muted-foreground text-sm"
              as={Link}
              href={addAccountTarget}>
              <Trans>Add another account</Trans>
            </LinkButton>
          </>
        )}
      </div>
    </AuthCard>
  );
}
