// cypress/component/resources/authorize/saml.cy.ts
//
// cy.task node-spec port of app/resources/authorize/__tests__/saml.test.ts. The SAML branch of
// /authorize gates on a signed `sessions` cookie, so it must run node-side. Stateless hand-off:
// validate → gate on session → 302 to the BFF /sso/saml-post (no response generated, no cookie).
import { callService } from '../../../support/node/call-service';

describe('/authorize — SAML branch (stateless hand-off)', () => {
  it('valid request WITH session → 302 to /sso/saml-post?id=<id> (no response generated, no cookie)', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/authorize?samlRequest=sr-post',
        sessions: [{ id: 's1', token: 't1', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/sso/saml-post?');
      expect(loc).to.include('id=sr-post');
      expect(loc).to.not.include('url=');
      expect(loc).to.not.include('SAMLResponse');
      // Stateless: /authorize must NOT set any cookie.
      expect(v.response?.setCookie).to.equal(null);
    });
  });

  it('redirect-binding request id WITH session → still just 302 to /sso/saml-post?id=<id>', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/authorize?samlRequest=sr-1',
        sessions: [{ id: 's1', token: 't1', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/sso/saml-post?');
      expect(loc).to.include('id=sr-1');
      expect(loc).to.not.include('SAMLResponse');
    });
  });

  it('WITHOUT session → 302 to /login carrying requestId=saml_sr-1', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      request: { url: 'http://localhost/id/authorize?samlRequest=sr-1' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include('requestId=saml_sr-1');
    });
  });

  it('invalid/expired request id → 302 to /error (fail fast before bootstrapping)', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/authorize?samlRequest=nope',
        sessions: [{ id: 's1', token: 't1', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/error');
      expect(loc).to.not.include('/sso/saml-post');
    });
  });
});
