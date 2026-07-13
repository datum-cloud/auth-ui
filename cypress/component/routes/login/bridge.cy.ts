// cypress/component/routes/login/bridge.cy.ts
//
// cy.task node-spec port of app/routes/login/__tests__/bridge.test.ts.
//
// Route-level wiring: the /login loader turns a bridge decision into a real 302 to /authorize
// preserving the query, and renders (no 302) for plain /login or ?requestId= returns.
import { callService } from '../../../support/node/call-service';

describe('/login loader → /authorize redirect wiring', () => {
  it('forwards ?authRequest= to /authorize, preserving the query', () => {
    callService({
      fn: 'loginLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/login?authRequest=V2_abc&organization=org1' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.contain('/authorize');
      expect(loc).to.contain('authRequest=V2_abc');
      expect(loc).to.contain('organization=org1');
    });
  });
});
