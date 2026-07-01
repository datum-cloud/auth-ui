// cypress/component/routes/login/notice-link-existing.cy.ts
//
// cy.task port of app/routes/login/__tests__/notice-link-existing.test.ts.
// The /login loader threads notice=link-existing from the URL into its returned data.
// NOTE: an explicit ?organization is threaded so the loader RENDERS — a bare /login now
// redirects (A1 org-first thread-in) before returning data, which would hide dataBody.
import { callService } from '../../../support/node/call-service';

describe('login/index loader — notice passthrough', () => {
  it('threads notice=link-existing into loader data', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login?loginName=you%40gmail.com&notice=link-existing&organization=org1',
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataBody).to.have.property('notice', 'link-existing');
    });
  });
});
