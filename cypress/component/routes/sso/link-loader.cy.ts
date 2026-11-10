// cypress/component/routes/sso/link-loader.cy.ts
//
// /sso/link loader, driven through the real route export. The page is a session gate in front
// of account linking: signed out it returns the sign-in-required prompt, signed in it either
// starts the link intent at the IdP or falls back to the /sso management screen.
// (sso-org-precedence.cy.ts owns the ?organization= threading; sso-returnto-cache.cy.ts owns
// the returnTo open-redirect guard.)
// Node-bound: the loader reads the signed `sessions` cookie.
import { callService, type AuditEvent } from '../../../support/node/call-service';

const LINK = 'http://localhost/id/sso/link';
const LIVE = [{ id: 'sess-1', token: 'tok-1', user: { id: 'u1', loginName: 'mia@acme.test' } }];
const COOKIE = [{ id: 'sess-1', token: 'tok-1', loginName: 'mia@acme.test' }];

interface PromptBody {
  mode: string;
  providers: Array<{ id: string; name: string }>;
  returnTo: string;
}

const linkStart = (audit: AuditEvent[]) => audit.filter((e) => e.event === 'idp.link.start');

describe('/sso/link loader', () => {
  it('signed in with a known provider starts the link intent and redirects to the IdP', () => {
    callService({
      fn: 'ssoLinkLoader',
      provider: 'singleton',
      liveSessions: LIVE,
      recordCalls: ['startIdpIntent'],
      request: { url: `${LINK}?provider=google`, sessions: COOKIE },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('https://idp.test/authorize?idp=idp-g');
      // The intent returns to the LINK variant of the callback, not the sign-in one.
      const [idpId, urls] = (v.calls?.startIdpIntent?.[0] ?? []) as [string, { success: string }];
      expect(idpId).to.equal('idp-g');
      expect(urls.success).to.include('/sso/google/callback');
      expect(urls.success).to.include('link=');
      expect(linkStart(v.audit).map((e) => e.outcome)).to.deep.equal(['success']);
    });
  });

  it('signed out returns the sign-in-required prompt with the org IdPs and a safe returnTo', () => {
    callService({
      fn: 'ssoLinkLoader',
      provider: 'singleton',
      recordCalls: ['startIdpIntent'],
      request: { url: `${LINK}?provider=google` },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.isResponse).to.equal(false);
      const body = v.response?.dataBody as PromptBody;
      expect(body.mode).to.equal('sign-in-required');
      expect(body.providers.map((p) => p.id)).to.include('idp-g');
      // Same-origin path + query only, so /login can send the user back here after sign-in.
      expect(body.returnTo).to.match(/\/sso\/link\?provider=google$/);
      expect(body.returnTo.startsWith('/')).to.equal(true);
      expect(v.calls?.startIdpIntent ?? []).to.have.length(0);
    });
  });

  it('a session cookie the provider no longer honours is treated as signed out', () => {
    callService({
      fn: 'ssoLinkLoader',
      provider: 'singleton',
      recordCalls: ['startIdpIntent'],
      request: { url: `${LINK}?provider=google`, sessions: COOKIE },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.isResponse).to.equal(false);
      expect((v.response?.dataBody as PromptBody).mode).to.equal('sign-in-required');
      expect(v.calls?.startIdpIntent ?? []).to.have.length(0);
    });
  });

  it('signed in with an unknown provider slug falls back to /sso without starting an intent', () => {
    callService({
      fn: 'ssoLinkLoader',
      provider: 'singleton',
      liveSessions: LIVE,
      recordCalls: ['startIdpIntent'],
      request: { url: `${LINK}?provider=not-an-idp`, sessions: COOKIE },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/sso');
      expect(v.calls?.startIdpIntent ?? []).to.have.length(0);
    });
  });

  it('an IdP that returns no auth URL falls back to /sso and audits the failed start', () => {
    callService({
      fn: 'ssoLinkLoader',
      provider: 'singleton',
      liveSessions: LIVE,
      failStartIdpIntent: true,
      request: { url: `${LINK}?provider=google`, sessions: COOKIE },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/sso');
      expect(linkStart(v.audit).map((e) => e.outcome)).to.deep.equal(['failure']);
    });
  });
});
