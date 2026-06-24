// Pass 2 service test (migrated from routes/sso/__tests__/ldap.test.ts).
// @vitest-environment node
//
// node env: happy-dom enforces the Fetch spec rule that forbids setting the `Cookie`
// header on a Request object. The /sso/ldap action's CSRF round-trip lived at the route;
// the extracted service `submitLdapCredentials` is driven directly here (CSRF is asserted
// by the route). We translate the typed outcome via outcomeToResponse — identical to what
// the route returns — so every status/redirect/data assertion is preserved verbatim.
import { getAuthProvider } from '@/modules/auth/select.server';
import { submitLdapCredentials, outcomeToResponse } from '@/resources/sso';
import { describe, it, expect } from 'vitest';

const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' });

/** Build the FormData + Request the LDAP service consumes. */
function ldapPost(fields: Record<string, string>): { request: Request; form: FormData } {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const request = new Request('http://localhost/id/sso/ldap', { method: 'POST' });
  return { request, form };
}

/** Drive the service exactly as the route does and return the translated value. */
async function runLdap(fields: Record<string, string>) {
  const { request, form } = ldapPost(fields);
  const outcome = await submitLdapCredentials(fake, request, form);
  return outcomeToResponse(outcome);
}

describe('/sso/ldap action (submitLdapCredentials)', () => {
  it('valid creds (bob/pw, idpId idp-ldap) → 302 to /signed-in with sessions cookie', async () => {
    const res = (await runLdap({ username: 'bob', password: 'pw', idpId: 'idp-ldap' })) as Response;

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toBe('/signed-in');

    // Verify a sessions cookie is set (cookie is HMAC-signed so we can't assert
    // plaintext content — assert the cookie name is present in the header).
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('sessions=');
  });

  it('valid creds WITH requestId → 302 to /authorize?requestId=oidc_x&sessionId=<id>', async () => {
    const res = (await runLdap({
      username: 'bob',
      password: 'pw',
      idpId: 'idp-ldap',
      requestId: 'oidc_x',
    })) as Response;

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    // Threads the just-created session id so resolveOidc's explicit-sessionId hand-back
    // finishes the callback (no select_account / login bounce). The fake provider mints ids
    // as `sess-<n>` from a shared counter, so assert structure, not the exact number.
    expect(location).toContain('/authorize?requestId=oidc_x');
    expect(location).toMatch(/[?&]sessionId=sess-\d+/);
  });

  it('bad creds → 401 with error INVALID_CREDENTIALS, not a redirect', async () => {
    const res = await runLdap({ username: 'bob', password: 'wrong', idpId: 'idp-ldap' });

    // Must NOT be a redirect
    expect(res instanceof Response && (res as Response).status === 302).toBe(false);
    // data() object: { data: {...}, init: { status: 401 } }
    const asData = res as { data?: { error?: string }; init?: { status?: number } };
    expect(asData.init?.status).toBe(401);
    expect(asData.data?.error).toBe('INVALID_CREDENTIALS');
  });

  it('valid creds but UNLINKED LDAP user (empty userId) → 403 ACCOUNT_NOT_LINKED, not a 500/redirect', async () => {
    // Mirrors real Zitadel: an LDAP credential exchange for an IdP user that is not
    // linked to any Zitadel account succeeds but returns userId='' (the resolved
    // intent is a 'register' draft, not a sign-in). Proceeding to createSession would
    // throw [failed_precondition] User ID missing → uncaught 500. The service must
    // instead surface a graceful, typed error.
    const res = await runLdap({ username: 'unlinked', password: 'pw', idpId: 'idp-ldap' });

    // Must NOT be a redirect (a 302 would mean we wrongly proceeded to sign-in).
    expect(res instanceof Response && (res as Response).status === 302).toBe(false);
    const asData = res as { data?: { error?: string }; init?: { status?: number } };
    expect(asData.init?.status).toBe(403);
    expect(asData.data?.error).toBe('ACCOUNT_NOT_LINKED');
  });

  it('missing idpId → 400 with error invalid_input, not a redirect', async () => {
    const res = await runLdap({ username: 'bob', password: 'pw' /* idpId omitted */ });

    // Must NOT be a redirect
    expect(res instanceof Response && (res as Response).status === 302).toBe(false);
    const asData = res as { data?: { error?: string }; init?: { status?: number } };
    expect(asData.init?.status).toBe(400);
    expect(asData.data?.error).toBe('invalid_input');
  });
});
