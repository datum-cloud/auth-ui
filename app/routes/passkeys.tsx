// /id/passkeys — the passkey management page (SSO-precedent purpose page).
//
// List + add (→ /setup/passkey with return) + sudo-gated remove with the server-side
// last-method guard, the post-removal "sign out other sessions?" dialog,
// and the backup-method banner when only one sign-in method exists.
import { AuthCard } from '@/components/auth-card/auth-card';
import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { FormError } from '@/components/form-error/form-error';
import { IdentityBadge } from '@/components/identity-badge/identity-badge';
import { SignOutButton } from '@/components/sign-out-button/sign-out-button';
import { useAuthActionError } from '@/hooks/use-auth-action-error';
import { readSessions, serializeSessions } from '@/modules/auth/session/cookie';
import { passkeysActionSchema } from '@/resources/passkeys/passkeys.schema';
import {
  loadPasskeysView,
  removeUserPasskey,
  signOutOtherSessions,
  type PasskeyRow,
} from '@/resources/passkeys/passkeys.service';
import { paths } from '@/routes/paths';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { env } from '@/server/infra/env.server';
import { actionError } from '@/utils/errors/auth-error';
import { Badge } from '@datum-cloud/datum-ui/badge';
import { Button, LinkButton } from '@datum-cloud/datum-ui/button';
import { Dialog } from '@datum-cloud/datum-ui/dialog';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Trans, useLingui } from '@lingui/react/macro';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';
import { Form as RRForm, Link } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Passkeys' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const provider = providerForRequest(request);
  const sessions = await readSessions(request);

  const result = await loadPasskeysView(provider, sessions, {
    returnTo: url.searchParams.get('returnTo'),
    nowMs: Date.now(),
    emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
  });
  if (result.kind === 'redirect') return redirect(result.target);

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data({ csrfToken, view: result }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const provider = providerForRequest(request);
  const form = await request.formData();
  await assertCsrf(request, form);

  const parsed = passkeysActionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

  const sessions = await readSessions(request);
  try {
    if (parsed.data.intent === 'remove') {
      const result = await removeUserPasskey(provider, sessions, {
        passkeyId: parsed.data.passkeyId,
        nowMs: Date.now(),
        emailDeliveryEnabled: env.AUTH_EMAIL_DELIVERY_ENABLED,
      });
      if (!result.ok) {
        // Stale sudo: bounce through /reauth and return here (server-side enforcement).
        if (result.error === 'SUDO_REQUIRED') {
          return redirect(paths.reauth({ returnTo: paths.passkeys() }));
        }
        return data({ error: result.error }, { status: 400 });
      }
      return data({ removed: result.removedName ?? '' });
    }
    // intent === 'signout-others': sudo-gated; deletes the user's OTHER
    // sessions cookie- AND provider-wide (all devices), keeps the active one.
    const result = await signOutOtherSessions(provider, sessions, { nowMs: Date.now() });
    if (!result.ok) {
      if (result.error === 'SUDO_REQUIRED') {
        return redirect(paths.reauth({ returnTo: paths.passkeys() }));
      }
      return data({ error: result.error }, { status: 400 });
    }
    return redirect(paths.passkeys(), {
      headers: { 'set-cookie': await serializeSessions(result.sessions) },
    });
  } catch (err) {
    return actionError(err);
  }
}

/**
 * Confirm-before-remove dialog for one passkey row. The destructive submit lives inside
 * the dialog so a stray click can't remove a sign-in method (mirrors UnlinkConfirmDialog).
 * Icon-only trash trigger (accounts.tsx precedent) + danger confirm.
 */
function RemoveConfirmDialog({ row, csrfToken }: { row: PasskeyRow; csrfToken: string }) {
  const [open, setOpen] = useState(false);
  const actionData = useActionData();
  // Close when any action result lands: on success the row unmounts anyway, but on a
  // refusal (LAST_METHOD) the inline error must not hide behind the modal overlay.
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
          className="text-muted-foreground hover:text-destructive shrink-0 p-0 transition-colors"
          aria-label={`Remove ${row.name}`}
          title={`Remove ${row.name}`}>
          <Icon icon={Trash2} size={16} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header
          title={<Trans>Remove this passkey?</Trans>}
          description={
            <Trans>"{row.name}" will no longer work for signing in. This cannot be undone.</Trans>
          }
        />
        <Dialog.Footer>
          <Button type="secondary" theme="outline" htmlType="button" onClick={() => setOpen(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <RRForm method="post">
            <AuthFormFields csrf={csrfToken} />
            <input type="hidden" name="intent" value="remove" />
            <input type="hidden" name="passkeyId" value={row.id} />
            <Button type="danger" theme="solid" htmlType="submit">
              <Trans>Remove passkey</Trans>
            </Button>
          </RRForm>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

/**
 * Post-removal session-hygiene offer as a dialog. "Not now" only
 * closes it; the sign-out submit reuses the existing signout-others action intent.
 */
function SignOutOthersDialog({
  open,
  onOpenChange,
  csrfToken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csrfToken: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Header
          title={<Trans>Passkey removed</Trans>}
          description={
            <Trans>
              Signed-in sessions on other devices can still be active. Sign out your other sessions?
            </Trans>
          }
        />
        <Dialog.Footer>
          <Button
            type="secondary"
            theme="outline"
            htmlType="button"
            onClick={() => onOpenChange(false)}>
            <Trans>Not now</Trans>
          </Button>
          <RRForm method="post">
            <AuthFormFields csrf={csrfToken} />
            <input type="hidden" name="intent" value="signout-others" />
            <Button type="danger" theme="solid" htmlType="submit">
              <Trans>Sign out other sessions</Trans>
            </Button>
          </RRForm>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export default function Passkeys() {
  const { csrfToken, view } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { passkeys, loginName, returnTo } = view;

  const errorCode = (actionData as { error?: string } | undefined)?.error;
  const genericError = useAuthActionError(actionData);
  const { i18n } = useLingui();

  // Open the sign-out-others dialog on each successful removal — actionData
  // is a fresh object per POST, so the effect fires exactly once per removal.
  const [signOutOpen, setSignOutOpen] = useState(false);
  useEffect(() => {
    // Open on a successful removal; close when any OTHER action result lands
    // (the signout-others redirect clears actionData without remounting this route).
    setSignOutOpen((actionData as { removed?: string } | undefined)?.removed !== undefined);
  }, [actionData]);

  return (
    <AuthCard
      title={<Trans>Passkeys</Trans>}
      description={
        <>
          <Trans>Passkeys let you sign in with your fingerprint, face, or device PIN.</Trans>
          {loginName && (
            <IdentityBadge
              loginName={loginName}
              verb={<Trans>Logged in as</Trans>}
              linkLabel={<Trans>Not you?</Trans>}
              linkTarget={paths.accounts()}
            />
          )}
        </>
      }
      className="max-w-[480px]">
      <div className="flex w-full flex-col gap-4">
        {errorCode === 'LAST_METHOD' ? (
          <FormError>
            <Trans>You can't remove your only sign-in method. Add another method first.</Trans>
          </FormError>
        ) : genericError ? (
          <FormError>{genericError}</FormError>
        ) : null}

        {passkeys.length === 0 ? (
          // Same minimal empty-state shape as /accounts and /sso.
          <p className="text-muted-foreground py-4 text-center text-sm">
            <Trans>No passkeys yet.</Trans>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {passkeys.map((row) => (
              <li
                key={row.id}
                className="border-border hover:bg-muted/50 flex items-center justify-between gap-3 rounded-md border p-3 transition-colors">
                <div className="flex min-w-0 items-start gap-3">
                  <Icon icon={KeyRound} className="mt-0.5 shrink-0" />
                  <div className="flex min-w-0 flex-col">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="truncate text-sm font-medium">{row.name}</span>
                      {row.state === 'inactive' ? (
                        // State is only surfaced when something is wrong — no "Active" noise.
                        <Badge
                          type="quaternary"
                          theme="light"
                          className="text-muted-foreground shrink-0 text-xs">
                          <Trans>Inactive</Trans>
                        </Badge>
                      ) : null}
                    </div>
                    {row.createdAt ? (
                      // Enroll date; absent for passkeys with no created-at metadata (no backfill).
                      <span className="text-muted-foreground text-xs">
                        <Trans>
                          Added {i18n.date(new Date(row.createdAt), { dateStyle: 'medium' })}
                        </Trans>
                      </span>
                    ) : null}
                  </div>
                </div>
                <RemoveConfirmDialog row={row} csrfToken={csrfToken} />
              </li>
            ))}
          </ul>
        )}

        <LinkButton
          size="large"
          className="h-13 gap-3"
          type="quaternary"
          theme="outline"
          block
          as={Link}
          href={paths.setup.passkey({ loginName, returnTo: paths.passkeys() })}
          iconPosition="left"
          icon={<Icon icon={Plus} />}>
          <Trans>Add passkey</Trans>
        </LinkButton>

        {returnTo && /^https?:\/\//.test(returnTo) ? (
          // Validated external entry point (portal round-trip) — offer the way back.
          <LinkButton type="secondary" theme="borderless" block href={returnTo}>
            <Trans>Back</Trans>
          </LinkButton>
        ) : null}

        <SignOutButton csrf={csrfToken} emphasis="secondary" />
      </div>

      <SignOutOthersDialog open={signOutOpen} onOpenChange={setSignOutOpen} csrfToken={csrfToken} />
    </AuthCard>
  );
}
