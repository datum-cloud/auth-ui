import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { IdpIcon } from '@/components/idp-icon/idp-icon';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { isAllowedRequestId } from '@/resources/authorize';
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
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans } from '@lingui/react/macro';
import { Trash2 } from 'lucide-react';
import {
  data,
  useLoaderData,
  useActionData,
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
  const candidate = new URL(request.url).searchParams.get('requestId') ?? undefined;
  const requestId = isAllowedRequestId(candidate) ? candidate : null;

  const { csrfToken, headers } = await loaderCsrf(request);

  return data({ csrfToken, accounts, requestId }, { headers });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form);

  const provider = providerForRequest(request);
  const outcome = await resolveAccountAction(provider, request, form);
  return accountActionOutcomeToResponse(outcome);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AccountPicker() {
  const { csrfToken, accounts, requestId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  // Inline-only error surface: the action error renders in a <FormError> (role="alert")
  // banner near the top of the accounts content — no toast.
  const errorMessage = useAuthActionError(actionData);

  return (
    <AuthCard
      title={<Trans>Choose an account</Trans>}
      description={<Trans>Select an account to continue or add a new one.</Trans>}
      className="max-w-[450px]">
      <div className="flex flex-col gap-3">
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
            <LinkButton
              theme="link"
              type="quaternary"
              as={Link}
              href={paths.login.index(requestId ? { requestId } : undefined)}>
              <Trans>Add an account</Trans>
            </LinkButton>
          </div>
        ) : (
          <>
            {/* Each row is itself the SWITCH target: the row-level <button type=submit> wraps
                the account info. The remove control is a SEPARATE sibling form — never nested
                inside the switch button — so there are no nested interactives (the prod a11y
                build rejects <button><button>/<button><a>). */}
            {accounts.map((account) => (
              <div key={account.sessionId} className="flex items-stretch gap-2 rounded-lg border">
                {/* Switch form: the whole account-info area is the submit control. */}
                <RRForm method="POST" className="min-w-0 flex-1">
                  {/* AuthFormFields carries csrf + the CURRENT ceremony id (requestId) so a
                      mid-OIDC/SAML/device switch resolves back into the protocol callback
                      instead of a terminal /signed-in page. requestId is null when no ceremony
                      is active → coerced to undefined so the hidden input is omitted. */}
                  <AuthFormFields csrf={csrfToken} requestId={requestId ?? undefined} />
                  <input type="hidden" name="intent" value="switch" />
                  <input type="hidden" name="sessionId" value={account.sessionId} />
                  <button
                    type="submit"
                    className="hover:bg-muted/50 focus-visible:ring-ring flex w-full items-center gap-2 rounded-l-lg p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none">
                    <IdpIcon
                      type={account.idpType}
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

                {/* Remove form — sibling, NOT nested in the switch button. */}
                <RRForm method="POST" className="flex shrink-0 items-center pr-2">
                  {/* Preserve the ceremony id on the post-remove redirect back to /accounts. */}
                  <AuthFormFields csrf={csrfToken} requestId={requestId ?? undefined} />
                  <input type="hidden" name="intent" value="remove" />
                  <input type="hidden" name="sessionId" value={account.sessionId} />
                  <Button
                    size="xs"
                    theme="link"
                    type="danger"
                    htmlType="submit"
                    className="text-destructive p-0"
                    aria-label="Remove account">
                    <Icon icon={Trash2} size={16} />
                  </Button>
                </RRForm>
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
              href={paths.login.index(requestId ? { requestId } : undefined)}>
              <Trans>Add another account</Trans>
            </LinkButton>
          </>
        )}
      </div>
    </AuthCard>
  );
}
