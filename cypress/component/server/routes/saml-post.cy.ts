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

  it('no session → 302 redirect to /id/login with requestId=saml_<id>', () => {
    callService({
      fn: 'samlPostCheck',
      samlPostOp: 'handlerNoSession',
      seed: { samlRequests: SAML_SEEDS },
    }).then((v) => {
      expect(v.outcome.status).to.equal(302);
      expect(v.outcome.location).to.include('/id/login');
      expect(v.outcome.location).to.include('requestId=saml_sr-post');
    });
  });

  it('valid session + POST-binding → 200 auto-submit form with ACS url and nonce', () => {
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
  });

  it('valid session + redirect-binding → 302 to the SP url', () => {
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

  it('valid session + unresolvable request id → 302 to /id/error', () => {
    callService({
      fn: 'samlPostCheck',
      samlPostOp: 'handlerUnresolvable',
      liveSessions: LIVE_SESSION,
      seed: { samlRequests: SAML_SEEDS },
    }).then((v) => {
      expect(v.outcome.status).to.equal(302);
      expect(v.outcome.location).to.include('/id/error');
    });
  });

  it('missing nonce on POST path → 500 (fail-closed: never emit nonce="undefined")', () => {
    callService({
      fn: 'samlPostCheck',
      samlPostOp: 'handlerMissingNonce',
      liveSessions: LIVE_SESSION,
      seed: { samlRequests: SAML_SEEDS },
    }).then((v) => {
      expect(v.outcome.status).to.equal(500);
    });
  });

  it('dead (stale-cookie) session → 302 to /id/login instead of serving a SAML assertion', () => {
    callService({
      fn: 'samlPostCheck',
      samlPostOp: 'handlerDeadSession',
      liveSessions: LIVE_SESSION,
      seed: { samlRequests: SAML_SEEDS },
    }).then((v) => {
      expect(v.outcome.status).to.equal(302);
      expect(v.outcome.location).to.include('/id/login');
    });
  });

  it('redirect-binding with javascript: ACS url → handler rejects via assertHttpUrl guard (SSRF/open-redirect gate)', () => {
    callService({
      fn: 'samlPostCheck',
      samlPostOp: 'handlerRedirectBadUrl',
      liveSessions: LIVE_SESSION,
      seed: { samlRequests: SAML_SEEDS },
    }).then((v) => {
      expect(v.outcome.status).to.be.oneOf([400, 500]);
    });
  });
});
