// cypress/component/server/csrf.cy.ts
// CY-TASK port of app/server/__tests__/csrf.test.ts
// Cookie header restriction makes this node-bound.
import { callService } from '../../support/node/call-service';

describe('getCsrfToken + assertCsrf (round-trip)', () => {
  it('resolves when the token and cookie match (happy path)', () => {
    callService({ fn: 'csrfCheck', csrfOp: 'roundTrip' }).then((v) => {
      expect(v.outcome.tokenLength).to.be.greaterThan(0);
      expect(v.outcome.setCookieMatches).to.equal(true);
      expect(v.outcome.resolved).to.equal(true);
    });
  });

  it('throws a 403 Response when the token is forged', () => {
    callService({ fn: 'csrfCheck', csrfOp: 'forgedToken' }).then((v) => {
      expect(v.outcome.status).to.equal(403);
    });
  });

  it('throws a 403 Response when the token is missing from the form', () => {
    callService({ fn: 'csrfCheck', csrfOp: 'missingToken' }).then((v) => {
      expect(v.outcome.status).to.equal(403);
    });
  });

  it('throws a 403 Response when the csrf cookie is missing', () => {
    callService({ fn: 'csrfCheck', csrfOp: 'missingCookie' }).then((v) => {
      expect(v.outcome.status).to.equal(403);
    });
  });
});

describe('CSRFError class', () => {
  it('is a subclass of Error', () => {
    callService({ fn: 'csrfCheck', csrfOp: 'csrfErrorClass' }).then((v) => {
      expect(v.outcome.isFunction).to.equal(true);
      expect(v.outcome.isInstance).to.equal(true);
    });
  });
});

describe('assertCsrfWith', () => {
  it('re-throws non-CSRF errors unchanged', () => {
    callService({ fn: 'csrfCheck', csrfOp: 'nonCsrfErrorRethrow' }).then((v) => {
      expect(v.outcome.rethrown).to.equal(true);
    });
  });
});
