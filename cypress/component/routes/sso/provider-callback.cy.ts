// cypress/component/routes/sso/provider-callback.cy.ts
//
// /sso/:provider/callback loader, driven through the real route export. The decision matrix
// (auto-link, auto-create, policyOrg, link ceremony) is pinned at the service level in
// cypress/component/resources/sso/sso-callback.cy.ts; this file pins the ROUTE: it resolves
// its own provider, threads the `:provider` slug, and turns the outcome into the redirect the
// browser follows — a session cookie on success, the provider's error page on failure.
// Node-bound: the loader signs the `sessions` cookie.
import { callService } from '../../../support/node/call-service';

const CB = (query: string) => `http://localhost/id/sso/google/callback?${query}`;
const SEED = { users: [{ id: 'u-linked', loginName: 'linked@idp.test', displayName: 'Linked' }] };
const LINKED_INTENT = {
  userId: 'u-linked',
  information: { idpId: 'idp-g', idpUserId: 'g-linked', idpUserName: 'linked@idp.test' },
  draft: null,
};

describe('/sso/:provider/callback loader', () => {
  it('an intent for an already-linked user signs them in and redirects with a session', () => {
    callService({
      fn: 'ssoProviderCallbackLoader',
      slug: 'google',
      seed: SEED,
      idpIntent: LINKED_INTENT,
      request: { url: CB('id=intent-1&token=tok-1') },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.not.include('/error');
      expect(v.response?.cookieEntries?.map((e) => e.loginName)).to.deep.equal(['linked@idp.test']);
      expect(v.response?.lastUsedLogin).to.equal('idp:idp-g');
      expect(v.audit.some((e) => e.event === 'idp.signin' && e.outcome === 'success')).to.equal(
        true
      );
    });
  });

  it('a callback missing id/token goes to the error page with reason=context-missing', () => {
    callService({
      fn: 'ssoProviderCallbackLoader',
      slug: 'google',
      seed: SEED,
      idpIntent: LINKED_INTENT,
      request: { url: CB('requestId=oidc_1') },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.include('/sso/google/error');
      expect(v.response?.location).to.include('reason=context-missing');
      // The ceremony context rides through so "Back to sign in" can resume it.
      expect(v.response?.location).to.include('requestId=oidc_1');
      expect(v.response?.setCookie ?? '').to.not.include('sessions=');
    });
  });

  it('an intent the IdP cannot resolve goes to the error page and mints no session', () => {
    callService({
      fn: 'ssoProviderCallbackLoader',
      slug: 'google',
      seed: SEED,
      idpIntentError: 'UNAVAILABLE',
      request: { url: CB('id=intent-1&token=tok-1') },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.include('/sso/google/error');
      expect(v.response?.setCookie ?? '').to.not.include('sessions=');
      expect(v.audit.some((e) => e.event === 'idp.signin' && e.outcome === 'failure')).to.equal(
        true
      );
    });
  });

  it('the error redirect uses the slug from the route params, not a fixed provider', () => {
    callService({
      fn: 'ssoProviderCallbackLoader',
      slug: 'github',
      seed: SEED,
      idpIntentError: 'UNAVAILABLE',
      request: { url: 'http://localhost/id/sso/github/callback?id=intent-1&token=tok-1' },
    }).then((v) => {
      expect(v.response?.location).to.include('/sso/github/error');
    });
  });
});
