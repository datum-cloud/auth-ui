/**
 * Shared helper: exchange a resolved IdP intent for a new session cookie.
 *
 * Extracted from the 'sign-in' branch of sso.$provider.callback.tsx so the
 * LDAP credential route (sso.ldap.tsx) can reuse the identical sequence without
 * duplicating it. The 'link' case in the callback has an extra addIdpLink() call
 * before creating the session — it intentionally does NOT use this helper to
 * avoid coupling unrelated logic.
 *
 * Returns the set-cookie header value and the redirect target URL so the caller
 * can perform the redirect with the cookie in one response.
 */
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { addSession, readSessions, serializeSessions } from '@/modules/auth/session/cookie';

export interface SignInWithIdpIntentOpts {
  /** The resolved intent id (from startLdapIntent or the callback query param). */
  idpIntentId: string;
  /** The intent token. */
  idpIntentToken: string;
  /** Zitadel user id — used for getUser lookup + session creation metadata. */
  userId: string;
  /** OIDC/device requestId; when present the redirect goes to /authorize. */
  requestId?: string;
  /** Org id forwarded to createSession. */
  organization?: string;
  /**
   * Fallback loginName when getUser returns null (e.g. LDAP credential entry
   * where the username is already available at the call site).
   */
  fallbackLoginName?: string;
}

export interface SignInWithIdpIntentResult {
  /** The value to set as the 'set-cookie' response header. */
  setCookie: string;
  /** The URL to redirect to after sign-in. */
  target: string;
}

export async function signInWithIdpIntent(
  provider: AuthProvider,
  request: Request,
  opts: SignInWithIdpIntentOpts
): Promise<SignInWithIdpIntentResult> {
  const { idpIntentId, idpIntentToken, userId, requestId, organization, fallbackLoginName } = opts;

  const session = await provider.createSession(
    { idpIntent: { idpIntentId, idpIntentToken } },
    { requestId, orgId: organization, userId }
  );

  const user = await provider.getUser(userId);
  const loginName = user?.loginName ?? fallbackLoginName ?? '';

  const entries = await readSessions(request);
  const next = addSession(entries, {
    id: session.id,
    token: session.token,
    loginName,
    organization,
    creationTs: session.changedAt,
    expirationTs: session.expiresAt,
    changeTs: session.changedAt,
    requestId,
  });

  const setCookie = await serializeSessions(next);
  const target = requestId ? `/authorize?requestId=${encodeURIComponent(requestId)}` : '/signed-in';

  return { setCookie, target };
}
