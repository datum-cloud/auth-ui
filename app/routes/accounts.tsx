import { AuthCard } from '@/components/auth-card';
import { SubmitButton } from '@/components/auth-form';
import type { Session, AuthMethod, LoginSettings } from '@/providers/types';
import { nextStepWithParams } from '@/routes/_shared/next-step-params';
import { providerForRequest } from '@/server/auth-context.server';
import { getCsrfToken, assertCsrf } from '@/server/csrf';
import { logAuthEvent, hashActor } from '@/server/observability';
import {
  readSessions,
  addSession,
  removeSession,
  serializeSessions,
  listSessions,
  byId,
} from '@/session/cookie';
import { Trans } from '@lingui/react/macro';
import {
  data,
  redirect,
  useLoaderData,
  useActionData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
  Form as RRForm,
  Link,
} from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Choose an account' }];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const switchSchema = z.object({
  intent: z.literal('switch'),
  sessionId: z.string().min(1),
});

const removeSchema = z.object({
  intent: z.literal('remove'),
  sessionId: z.string().min(1),
});

// ─── Shared types ─────────────────────────────────────────────────────────────

interface EnrichedAccount {
  sessionId: string;
  loginName: string;
  organization?: string;
  displayName?: string;
  /** path === '/signed-in' means the session is fully active */
  nextPath: string;
  isActive: boolean;
}

/** Shared fallback when getLoginSettings call fails */
const DEFAULT_LOGIN_SETTINGS = {
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: false,
  passkeysType: 'not_allowed' as const,
  forceMfa: false,
};

// ─── Private helper ───────────────────────────────────────────────────────────

/**
 * Resolves the next navigation path for a session entry.
 *
 * Fetches enrolledMethods and loginSettings in parallel (both tolerate
 * failures), derives userVerified from passkey factors, then delegates
 * to nextStepWithParams for the canonical step-routing logic.
 */
async function resolveNextPath(
  provider: ReturnType<typeof providerForRequest>,
  session: Session,
  entry: { loginName: string; organization?: string; requestId?: string }
): Promise<string> {
  const userId = session.user?.id ?? '';

  const [enrolledMethods, loginSettings] = await Promise.all([
    userId
      ? provider.listAuthMethods(userId).catch(() => [] as AuthMethod[])
      : Promise.resolve([] as AuthMethod[]),
    provider.getLoginSettings(entry.organization).catch(() => DEFAULT_LOGIN_SETTINGS),
  ]);

  const userVerified = session.factors.passkey?.userVerified ?? false;

  return nextStepWithParams({
    factors: session.factors,
    settings: loginSettings,
    enrolledMethods,
    loginName: entry.loginName,
    userVerified,
    mfaInitSkippedAt: session.user?.mfaInitSkippedAt ?? null,
    requestId: entry.requestId,
    organization: entry.organization,
  });
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const cookieSessions = await readSessions(request);

  // Filter to non-expired entries using current time (shared helper handles
  // both epoch-string and ISO expirationTs formats).
  const liveSessions = listSessions(cookieSessions, Date.now());

  if (liveSessions.length === 0) {
    // Empty state: render the page with an empty account list (no redirect loop)
    const [csrfToken, setCookie] = await getCsrfToken(request);
    const headers: Record<string, string> = {};
    if (setCookie !== null) headers['set-cookie'] = setCookie;
    return data({ csrfToken, accounts: [] as EnrichedAccount[] }, { headers });
  }

  const provider = providerForRequest(request);

  // Enrich via provider.listSessions (read-only; returned sessions have token: '')
  const sessionIds = liveSessions.map((s) => s.id);
  let providerSessions: Session[];
  try {
    providerSessions = await provider.listSessions(sessionIds);
  } catch {
    // If the bulk lookup fails entirely, fall through with an empty enrichment list
    providerSessions = [];
  }

  const providerMap = new Map<string, Session>(providerSessions.map((s) => [s.id, s]));

  // Pre-fetch loginSettings once per distinct organization to avoid redundant
  // round-trips when multiple sessions share the same org (or are all orgless).
  const distinctOrgs = new Set(liveSessions.map((s) => s.organization));
  const settingsMap = new Map<string | undefined, LoginSettings>();
  await Promise.all(
    [...distinctOrgs].map(async (org) => {
      const settings = await provider.getLoginSettings(org).catch(() => DEFAULT_LOGIN_SETTINGS);
      settingsMap.set(org, settings);
    })
  );

  // For each live cookie entry, build an EnrichedAccount.
  // Per-session failures are tolerated gracefully (renders needs-re-auth card).
  const accounts = await Promise.all(
    liveSessions.map(async (entry): Promise<EnrichedAccount> => {
      const pSession = providerMap.get(entry.id);

      // Default (degraded) card if provider has no data for this session
      if (!pSession) {
        return {
          sessionId: entry.id,
          loginName: entry.loginName,
          organization: entry.organization,
          displayName: undefined,
          nextPath: '/login',
          isActive: false,
        };
      }

      const userId = pSession.user?.id ?? '';
      const loginSettings = settingsMap.get(entry.organization) ?? DEFAULT_LOGIN_SETTINGS;

      const enrolledMethods = await (userId
        ? provider.listAuthMethods(userId).catch(() => [] as AuthMethod[])
        : Promise.resolve([] as AuthMethod[]));

      const userVerified = pSession.factors.passkey?.userVerified ?? false;

      const nextPath = nextStepWithParams({
        factors: pSession.factors,
        settings: loginSettings,
        enrolledMethods,
        loginName: entry.loginName,
        userVerified,
        mfaInitSkippedAt: pSession.user?.mfaInitSkippedAt ?? null,
        requestId: entry.requestId,
        organization: entry.organization,
      });

      return {
        sessionId: entry.id,
        loginName: entry.loginName,
        organization: entry.organization,
        displayName: pSession.user?.displayName,
        nextPath,
        isActive: nextPath === '/signed-in' || nextPath.startsWith('/signed-in?'),
      };
    })
  );

  const [csrfToken, setCookie] = await getCsrfToken(request);
  const headers: Record<string, string> = {};
  if (setCookie !== null) headers['set-cookie'] = setCookie;

  return data({ csrfToken, accounts }, { headers });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  await assertCsrf(request, form);

  const intent = form.get('intent') as string | null;

  // ── switch ──────────────────────────────────────────────────────────────────
  if (intent === 'switch') {
    const parsed = switchSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

    const { sessionId } = parsed.data;
    const cookieSessions = await readSessions(request);
    const entry = byId(cookieSessions, sessionId);
    if (!entry) return data({ error: 'NOT_FOUND' as const }, { status: 404 });

    const provider = providerForRequest(request);

    // Re-fetch fresh session state for an accurate nextStep determination
    let nextPath: string;
    let userId: string;
    try {
      const freshSession = await provider.getSession(entry.id, entry.token);
      if (!freshSession) {
        logAuthEvent('account_switch', 'failure', { sessionId });
        return data({ error: 'SESSION_EXPIRED' as const }, { status: 400 });
      }

      userId = freshSession.user?.id ?? entry.loginName;
      nextPath = await resolveNextPath(provider, freshSession, entry);
    } catch {
      logAuthEvent('account_switch', 'failure', { sessionId });
      return data({ error: 'PROVIDER_ERROR' as const }, { status: 500 });
    }

    // Touch the session in the cookie (re-order to most-recent via addSession)
    const updated = addSession(cookieSessions, { ...entry, changeTs: String(Date.now()) });

    logAuthEvent('account_switch', 'success', { sessionId, userId });

    return redirect(nextPath, {
      headers: { 'set-cookie': await serializeSessions(updated) },
    });
  }

  // ── remove ──────────────────────────────────────────────────────────────────
  if (intent === 'remove') {
    const parsed = removeSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return data({ error: 'INVALID_INPUT' as const }, { status: 400 });

    const { sessionId } = parsed.data;
    const cookieSessions = await readSessions(request);
    const entry = byId(cookieSessions, sessionId);
    if (!entry) {
      logAuthEvent('account_remove', 'failure', { sessionId, reason: 'not_found' });
      return data({ error: 'NOT_FOUND' as const }, { status: 404 });
    }

    const provider = providerForRequest(request);

    // Delete provider-side (best-effort — cookie removal proceeds even if provider call fails)
    try {
      await provider.deleteSession(entry.id, entry.token);
    } catch {
      logAuthEvent('account_remove', 'failure', {
        sessionId,
        actor: hashActor(entry.loginName),
        reason: 'provider_error',
      });
      // Tolerate provider errors; the session will still be removed from the cookie
    }

    const updated = removeSession(cookieSessions, sessionId);
    logAuthEvent('account_remove', 'success', { sessionId, actor: hashActor(entry.loginName) });

    return redirect('/accounts', {
      headers: { 'set-cookie': await serializeSessions(updated) },
    });
  }

  return data({ error: 'INVALID_INPUT' as const }, { status: 400 });
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
