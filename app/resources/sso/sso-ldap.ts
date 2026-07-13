// app/resources/sso/sso-ldap.ts
//
// /sso/ldap action business logic: LDAP credential sign-in.
// Extracted from sso.service.ts. Pure-internal decomposition — the
// `submitLdapCredentials` signature + `ldapServerSchema`/`LdapActionData` are
// unchanged and re-exported through the sso barrel.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { ProviderError } from '@/modules/auth/types';
import { signInWithIdpIntent } from '@/resources/sso/idp-session';
import type { SsoOutcome } from '@/resources/sso/sso-outcome';
import { logAuthEvent } from '@/server/observability';
import { z } from 'zod';

// ── /sso/ldap action ──────────────────────────────────────────────────────────────

export const ldapServerSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  idpId: z.string().min(1),
  requestId: z.string().optional(),
  organization: z.string().optional(),
});

/**
 * The error payload the /sso/ldap action surfaces to its component (via useActionData).
 * `INVALID_CREDENTIALS` / `ACCOUNT_NOT_LINKED` / `invalid_input` are recognized; any other
 * ProviderError code rides through as a generic string the component maps to a fallback.
 */
export type LdapActionData = { error: string };

/**
 * /sso/ldap action logic. Validates the full form, exchanges credentials for an LDAP intent,
 * maps ProviderErrors to typed data responses (401 INVALID_CREDENTIALS / 400 <code>), guards
 * the unlinked-user (empty userId) case into a typed 403 ACCOUNT_NOT_LINKED, and on success
 * mints a session via the shared signInWithIdpIntent helper. CSRF is asserted by the route.
 */
export async function submitLdapCredentials(
  provider: AuthProvider,
  request: Request,
  form: FormData
): Promise<SsoOutcome> {
  const parsed = ldapServerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    logAuthEvent('ldap_signin', 'failure', { reason: 'invalid_input' });
    return { kind: 'data', payload: { error: 'invalid_input' as const }, status: 400 };
  }

  const { idpId, username, requestId, organization } = parsed.data;

  let ldapIntent;
  try {
    ldapIntent = await provider.startLdapIntent(idpId, username, parsed.data.password);
  } catch (error) {
    if (error instanceof ProviderError) {
      if (error.code === 'INVALID_CREDENTIALS') {
        logAuthEvent('ldap_signin', 'failure', { reason: error.code, idpId });
        return { kind: 'data', payload: { error: 'INVALID_CREDENTIALS' as const }, status: 401 };
      }
      logAuthEvent('ldap_signin', 'failure', { reason: error.code, idpId });
      return { kind: 'data', payload: { error: error.code as string }, status: 400 };
    }
    throw error;
  }

  const { userId, idpIntentId, idpIntentToken } = ldapIntent;

  // Real Zitadel returns valid LDAP credentials with an empty userId when the IdP
  // user is NOT linked to any Zitadel account (the resolved intent is a 'register'
  // draft, not a sign-in). Proceeding to createSession throws [failed_precondition]
  // 'User ID missing' → an uncaught 500. Direct sign-in only supports already-linked
  // accounts; register-and-link via LDAP is deferred (see /sso ldap-link guard).
  // Fail gracefully with a typed error instead of leaking a 500.
  if (!userId) {
    logAuthEvent('ldap_signin', 'failure', { reason: 'account_not_linked', idpId });
    return { kind: 'data', payload: { error: 'ACCOUNT_NOT_LINKED' as const }, status: 403 };
  }

  const { setCookie, target, reauthClearCookie } = await signInWithIdpIntent(provider, request, {
    idpIntentId,
    idpIntentToken,
    userId,
    requestId,
    organization,
    fallbackLoginName: username,
  });

  logAuthEvent('ldap_signin', 'success', { idpId, userId, requestId });

  // Thread reauthClearCookie through the outcome (outcomeToResponse appends it). Dropping it
  // left a stale reauth-intent marker that false-mismatches the NEXT login's identity check.
  return { kind: 'redirect', location: target, setCookie, reauthClearCookie };
}
