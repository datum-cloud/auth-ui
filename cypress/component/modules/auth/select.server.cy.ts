// cypress/component/modules/auth/select.server.cy.ts
//
// Node-bound (cy.task) port of app/modules/auth/__tests__/select.server.test.ts.
//
// select.server.ts is stubbed out of the Vite browser bundle (it imports the server-only
// ZitadelAuthProvider gRPC transport), and the stub returns a fake-only registry — so asserting
// against it in the browser would test the STUB, not the real binding point. The REAL
// getAuthProvider (fake↔zitadel selection) runs in Bun via cy.task.
import { callService } from '../../../support/node/call-service';

describe('getAuthProvider', () => {
  it('returns the FakeAuthProvider when AUTH_PROVIDER=fake, and a Zitadel-backed provider otherwise', () => {
    callService({
      fn: 'selectProvider',
      selectOp: 'fakeIsInstance',
      request: { url: 'http://localhost/id' },
    })
      .then((v) => {
        expect((v.outcome as { isFake: boolean }).isFake).to.equal(true);
        return callService({
          fn: 'selectProvider',
          selectOp: 'zitadelNoThrow',
          request: { url: 'http://localhost/id' },
        });
      })
      .then((v) => {
        expect((v.outcome as { threw: boolean }).threw).to.equal(false);
      });
  });
});
