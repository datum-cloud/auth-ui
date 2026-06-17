import { AuthCard } from '@/components/auth-card/auth-card';
import { SubmitButton } from '@/components/auth-form/auth-form';
import {
  listAccounts,
  resolveAccountAction,
  accountActionOutcomeToResponse,
} from '@/resources/session';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { Trans } from '@lingui/react/macro';
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

  return (
    <AuthCard
      title={<Trans>Choose an account</Trans>}
      description={<Trans>Select an account to continue or add a new one.</Trans>}>
      <div className="flex flex-col gap-3">
        {actionData && 'error' in actionData && (
          <p role="alert" className="text-sm text-red-700">
            {actionData.error === 'SESSION_EXPIRED' ? (
              <Trans>Your session has expired.</Trans>
            ) : actionData.error === 'NOT_FOUND' ? (
              <Trans>Account not found.</Trans>
            ) : (
              <Trans>Something went wrong. Please try again.</Trans>
            )}
          </p>
        )}

        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-muted-foreground text-center text-sm">
              <Trans>No signed-in accounts.</Trans>
            </p>
            {/* Plain styled Link: this Button API (semi-style type/theme props) has no
                Slot-based asChild — Button asChild renders <button><a>, an axe
                nested-interactive violation. */}
            <Link
              to="/login"
              className="bg-btn-primary border-btn-primary-border text-btn-primary-foreground hover:bg-btn-primary-hover inline-flex w-full items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors">
              <Trans>Add an account</Trans>
            </Link>
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
                  {account.displayName && (
                    <span className="text-muted-foreground truncate text-xs">
                      {account.loginName}
                    </span>
                  )}
                  {/* 700-shades: green-600/amber-600 fail axe color-contrast at text-xs on white */}
                  <span
                    className={`mt-0.5 text-xs ${account.isActive ? 'text-green-700' : 'text-amber-700'}`}>
                    {account.isActive ? (
                      <Trans>Session active</Trans>
                    ) : (
                      <Trans>Needs re-authentication</Trans>
                    )}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* Switch form */}
                  <RRForm method="POST">
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="intent" value="switch" />
                    <input type="hidden" name="sessionId" value={account.sessionId} />
                    <SubmitButton className="px-3 py-1.5 text-xs">
                      <Trans>Switch</Trans>
                    </SubmitButton>
                  </RRForm>

                  {/* Remove form */}
                  <RRForm method="POST">
                    <input type="hidden" name="csrf" value={csrfToken} />
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="sessionId" value={account.sessionId} />
                    <button
                      type="submit"
                      className="text-muted-foreground text-xs underline hover:text-red-600">
                      <Trans>Remove</Trans>
                    </button>
                  </RRForm>
                </div>
              </div>
            ))}

            <Link
              to="/login"
              className="text-muted-foreground mt-1 text-center text-sm hover:underline">
              <Trans>Add another account</Trans>
            </Link>
          </>
        )}
      </div>
    </AuthCard>
  );
}
