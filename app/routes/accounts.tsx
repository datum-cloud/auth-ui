import { AuthCard } from '@/components/auth-card/auth-card';
import { useActionErrorToast } from '@/hooks/use-action-error-toast';
import {
  listAccounts,
  resolveAccountAction,
  accountActionOutcomeToResponse,
} from '@/resources/session';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { useAuthErrorMessage } from '@/utils/errors/auth-error-messages';
import { Button } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Tooltip } from '@datum-cloud/datum-ui/tooltip';
import { Trans } from '@lingui/react/macro';
import { ArrowLeftRight, Trash2 } from 'lucide-react';
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

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data({ csrfToken, accounts }, { headers });
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
  const { csrfToken, accounts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const getErrorMessage = useAuthErrorMessage();
  useActionErrorToast(getErrorMessage((actionData as { error?: string } | undefined)?.error));

  return (
    <AuthCard
      title={<Trans>Choose an account</Trans>}
      description={<Trans>Select an account to continue or add a new one.</Trans>}
      className="max-w-[450px]">
      <div className="flex flex-col gap-3">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-muted-foreground text-center text-sm">
              <Trans>No signed-in accounts.</Trans>
            </p>
            {/* Plain styled Link: this Button API (semi-style type/theme props) has no
                Slot-based asChild — Button asChild renders <button><a>, an axe
                nested-interactive violation. */}
            <Button theme="link" type="quaternary" asChild>
              <Link to="/login">
                <Trans>Add an account</Trans>
              </Link>
            </Button>
          </div>
        ) : (
          <>
            {accounts.map((account) => (
              <div
                key={account.sessionId}
                className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {account.displayName ?? account.loginName}
                  </span>
                  <span
                    className={`mt-0.5 text-xs ${account.isActive ? 'text-muted-foreground' : 'text-destructive/80'}`}>
                    {account.isActive ? (
                      <Trans>Session active</Trans>
                    ) : (
                      <Trans>Needs re-authentication</Trans>
                    )}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {/* Switch form */}
                  <RRForm method="POST" className="flex items-center">
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="intent" value="switch" />
                    <input type="hidden" name="sessionId" value={account.sessionId} />
                    <Button
                      size="xs"
                      theme="link"
                      type="quaternary"
                      htmlType="submit"
                      className="text-foreground/80 p-0"
                      asChild>
                      <Tooltip message={<Trans>Switch</Trans>}>
                        <Icon icon={ArrowLeftRight} size={16} />
                      </Tooltip>
                    </Button>
                  </RRForm>

                  {/* Remove form */}
                  <RRForm method="POST" className="flex items-center">
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="sessionId" value={account.sessionId} />
                    <Button
                      size="xs"
                      theme="link"
                      type="danger"
                      htmlType="submit"
                      className="text-destructive p-0"
                      asChild>
                      <Tooltip message={<Trans>Remove</Trans>}>
                        <Icon icon={Trash2} size={16} />
                      </Tooltip>
                    </Button>
                  </RRForm>
                </div>
              </div>
            ))}

            <Button
              theme="link"
              type="quaternary"
              className="text-muted-foreground text-sm"
              asChild>
              <Link to="/login">
                <Trans>Add another account</Trans>
              </Link>
            </Button>
          </>
        )}
      </div>
    </AuthCard>
  );
}
