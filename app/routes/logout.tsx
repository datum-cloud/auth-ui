import { AuthCard } from '@/components/auth-card';
import { providerForRequest } from '@/server/auth-context.server';
import { assertCsrf, getCsrfToken } from '@/server/csrf';
import { logAuthEvent, hashActor } from '@/server/observability';
import { readSessions, mostRecent, removeSession, serializeSessions } from '@/session/cookie';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import {
  data,
  redirect,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import type { MetaFunction } from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Sign out' }];

/**
 * validatePostLogoutRedirect — fail-closed placeholder.
 *
 * post_logout_redirect_uri allowlist lands when OIDC end-session wiring does;
 * fail-closed until then — never echo a caller-supplied URL.
 */
function validatePostLogoutRedirect(_request: Request): string | null {
  return null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  return data({ csrfToken }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form); // CSRF on the state-changing POST

  const sessions = await readSessions(request);
  const active = mostRecent(sessions); // the cookie's active entry (if any)

  if (active) {
    const provider = providerForRequest(request);

    // deleteSession may throw if the session is already gone on the provider side
    // (e.g. expired, or a transport error). Wrap in try/catch — on failure emit an
    // audit event but CONTINUE clearing the local cookie and redirecting.
    // Local sign-out MUST always succeed: the cookie is the source of truth for the
    // UI and an unreachable provider must not leave the user stuck on /signed-in.
    try {
      await provider.deleteSession(active.id, active.token);
      logAuthEvent('logout', 'success', {
        actor: hashActor(active.loginName),
        sessionId: active.id,
      });
    } catch (err) {
      // reason distinguishes transport outages from stale sessions in ops triage (no tokens logged)
      logAuthEvent('logout', 'failure', {
        sessionId: active.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      // fall through — clear cookie + redirect regardless
    }
  }

  // removeSession takes a string ID; only call it when active exists.
  const next = active ? removeSession(sessions, active.id) : sessions;

  // CODE-MAJ-10: make session scope explicit and safe.
  //
  // Decision: SINGLE-SESSION logout + account-selection guard.
  //
  // Rationale: We remove only the most-recent (active) session from the cookie. Removing
  // ALL sessions would silently strand tabs that have legitimately authenticated as a
  // different account (e.g. multi-tenant users). However, leaving residual sessions with
  // a plain /logout/success redirect allows authorize.tsx to silently reuse mostRecent()
  // of those residuals on the next /authorize hit — signing the user back in without
  // any interaction. That is the bug this guard closes.
  //
  // Guard: when residual sessions remain in the cookie after the single-session removal,
  // redirect to /accounts instead of /logout/success. /accounts forces the user to
  // explicitly choose a session before any new sign-in, preventing the silent-reuse path.
  // When no residual sessions remain, /logout/success is the correct destination.
  const explicitTarget = validatePostLogoutRedirect(request);
  const hasResidualSessions = next.length > 0;
  const target = explicitTarget ?? (hasResidualSessions ? '/accounts' : '/logout/success');
  return redirect(target, {
    headers: { 'set-cookie': await serializeSessions(next) },
  });
}

export default function Logout() {
  const { csrfToken } = useLoaderData<typeof loader>();
  return (
    <AuthCard title={<Trans>Sign out</Trans>}>
      <div className="flex flex-col gap-4 text-center">
        <p className="text-foreground">
          <Trans>Are you sure you want to sign out?</Trans>
        </p>
        <form method="post">
          <input type="hidden" name="csrf" value={csrfToken} />
          <Button type="primary" theme="solid" htmlType="submit" block>
            <Trans>Sign out</Trans>
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
