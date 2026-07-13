// cypress/component/server/routes/saml-post.cy.ts
// CY-TASK port of app/server/routes/__tests__/saml-post.test.ts (handler tests only).
// Pure-function tests (assertHttpUrl, renderSamlPostForm) live in saml-post.url-guard.cy.ts.
import { callService } from '../../../support/node/call-service';

// Shared seeds — both binding types loaded so handler ops don't have to repeat them.
const SAML_SEEDS = [
  { id: 'sr-post', clientId: 'client-1', binding: 'post' as const },
  { id: 'sr-1', clientId: 'client-1', binding: 'redirect' as const },
];
const LIVE_SESSION = [{ id: 's1', token: 't1', loginName: 'alice@acme.test' }];

describe('samlPostHandler', () => {
  it('missing ?id= query param → 400', () => {
    callService({
      fn: 'samlPostCheck',
      samlPostOp: 'handlerMissingId',
    }).then((v) => {
      expect(v.outcome.status).to.equal(400);
    });
  });

  it('valid session renders POST-binding auto-submit form (200) and redirects for redirect-binding (302)', () => {
    callService({
      fn: 'samlPostCheck',
      samlPostOp: 'handlerPostBinding',
      liveSessions: LIVE_SESSION,
      seed: { samlRequests: SAML_SEEDS },
    }).then((v) => {
      expect(v.outcome.status).to.equal(200);
      expect(v.outcome.body).to.include('action="https://sp.test/acs"');
      expect(v.outcome.body).to.include('name="SAMLResponse" value="resp-sr-post"');
      expect(v.outcome.body).to.include('name="RelayState" value="rs-sr-post"');
      expect(v.outcome.body).to.include('<script nonce="n-1">');
    });

    callService({
      fn: 'samlPostCheck',
      samlPostOp: 'handlerRedirectBinding',
      liveSessions: LIVE_SESSION,
      seed: { samlRequests: SAML_SEEDS },
    }).then((v) => {
      expect(v.outcome.status).to.equal(302);
      expect(v.outcome.location).to.include('https://sp.test/acs');
      expect(v.outcome.location).to.include('SAMLResponse=resp-sr-1');
    });
  });
});
