// cypress/component/routes/login/notice-link-existing.cy.ts
//
// cy.task port of app/routes/login/__tests__/notice-link-existing.test.ts.
// The /login loader threads notice=link-existing from the URL into its returned data.
import { callService } from '../../../support/node/call-service';

describe('login/index loader — notice passthrough', () => {
  it('threads notice=link-existing into loader data', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login?loginName=you%40gmail.com&notice=link-existing',
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataBody).to.have.property('notice', 'link-existing');
    });
  });

  it('omits notice when absent', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      const notice = (v.response?.dataBody as Record<string, unknown> | undefined)?.notice ?? null;
      expect(notice).to.equal(null);
    });
  });
});
