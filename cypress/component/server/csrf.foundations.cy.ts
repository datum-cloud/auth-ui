// cypress/component/server/csrf.foundations.cy.ts
// CY-TASK port of app/server/__tests__/csrf.foundations.test.ts
import { callService } from '../../support/node/call-service';

describe('loaderCsrf', () => {
  it('returns a non-empty csrfToken string', () => {
    callService({ fn: 'csrfFoundationsCheck', csrfFoundationsOp: 'loaderCsrfToken' }).then((v) => {
      expect(v.outcome.tokenLength).to.be.greaterThan(0);
    });
  });

  it('uses CSRF_FORM_KEY as the form field name', () => {
    callService({ fn: 'csrfFoundationsCheck', csrfFoundationsOp: 'formKeyInSource' }).then((v) => {
      expect(v.outcome.containsKey).to.equal(true);
      expect(v.outcome.keyValue).to.equal('csrf');
    });
  });
});
