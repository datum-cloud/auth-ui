import { AuthCard } from '@/components/auth-card';
import { postLoginDestinationWithSource } from '@/flows/post-login-destination';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken } from '@/server/csrf';
import { logAuthEvent } from '@/server/observability';
// ADAPTATION (import drift fix): readSessions/mostRecent live in @/session/cookie
// (re-exports session.ts helpers; canonical one-stop import for route loaders).
import { readSessions, mostRecent } from '@/session/cookie';
import { env } from '@/utils/env.server';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { data, redirect, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Signed in' }];

export async function loader({ request }: LoaderFunctionArgs) {
  // A ceremony that still carries a protocol request must hand back to the orchestrator:
  // oidc_/saml_ to finish the callback (createCallback → client redirect with ?code=),
  // device_ to return to the /device/authorize consent screen (the MFA-setup-skip path
  // lands here with the requestId still threaded). /signed-in is only the terminal page
  // for standalone (requestId-less) logins.
  const requestId = new URL(request.url).searchParams.get('requestId');
  if (
    requestId &&
    (requestId.startsWith('oidc_') ||
      requestId.startsWith('saml_') ||
      requestId.startsWith('device_'))
  ) {
    return redirect(`/authorize?requestId=${encodeURIComponent(requestId)}`);
  }

  const list = await readSessions(request);
  const recent = mostRecent(list);
  if (!recent) return redirect('/login');

  const provider = providerForRequest(request);
  type Settings = Awaited<ReturnType<typeof provider.getLoginSettings>>;
  const [settings, isAdmin] = await Promise.all([
    provider.getLoginSettings(recent.organization).catch((err) => {
      // CODE-MAJ-05: surface transient backend failure in the audit trail; behavior
      // (graceful degradation to env/none) is unchanged.
      logAuthEvent('post_login_settings', 'failure', {
        reason: err instanceof Error ? err.message : String(err),
      });
      return {} as Partial<Settings>;
    }),
    provider.isInstanceAdmin({ id: recent.id, token: recent.token }).catch((err) => {
      logAuthEvent('post_login_admin_check', 'failure', {
        reason: err instanceof Error ? err.message : String(err),
      });
      return false;
    }),
  ]);

  const { dest, source } = postLoginDestinationWithSource({
    isAdmin,
    consoleUrl: `${env.ZITADEL_API_URL}/ui/console`,
    defaultRedirectUri: settings.defaultRedirectUri,
    defaultAppUrl: env.DEFAULT_APP_URL,
  });

  logAuthEvent('post_login_redirect', dest ? 'success' : 'failure', { isAdmin, source });

  if (dest) return redirect(dest);

  // Nothing configured → terminal "You are signed in" page.
  const [csrfToken, setCookie] = await getCsrfToken(request);
  // DEVIATION (getCsrfToken null-guard): only set 'set-cookie' when non-null (same pattern as login.tsx).
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data({ loginName: recent.loginName ?? null, csrfToken }, { headers });
}

export default function SignedIn() {
  const { loginName, csrfToken } = useLoaderData<typeof loader>();
  return (
    <AuthCard title={<Trans>You are signed in</Trans>}>
      <div className="flex flex-col gap-4 text-center">
        {/* ADAPTATION (contrast fix): text-foreground instead of text-muted-foreground
            (Phase 0 finding: muted-foreground fails WCAG AA at 3.47:1). */}
        {loginName ? <p className="text-foreground">{loginName}</p> : null}
        {/* Sign-out form: plain <form> with explicit /id/logout action so the browser
            posts to the literal path (RR basename-prefixing only applies to RR <Form>).
            The logout journey selects form[action="/id/logout"] — keep the selector intact. */}
        <form method="post" action="/id/logout">
          <input type="hidden" name="csrf" value={csrfToken} />
          <Button type="primary" theme="solid" htmlType="submit" block>
            <Trans>Sign out</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
