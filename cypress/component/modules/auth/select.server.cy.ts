// cypress/component/modules/auth/select.server.cy.ts
//
// Node-bound (cy.task) port of app/modules/auth/__tests__/select.server.test.ts.
//
// select.server.ts is stubbed out of the Vite browser bundle (it imports the server-only
// ZitadelAuthProvider gRPC transport), and the stub returns a fake-only registry — so asserting
// against it in the browser would test the STUB, not the real binding point. The REAL
// getAuthProvider (fake↔zitadel selection) runs in Bun via cy.task.
//
// Absorbed provider-registry.cy.ts (deleted): it drove the SAME production module through the
// same `fn: 'selectProvider'` task, differing only by `selectOp`, so both now chain in one test —
// matching the 4-call chaining pattern transport.cy.ts already uses. Every assertion is kept.
import { callService } from '../../../support/node/call-service';

describe('select.server — providerRegistry binding points + getAuthProvider', () => {
  it('exposes exactly fake+zitadel with a stable singleton, and selects the provider per AUTH_PROVIDER', () => {
    callService({
      fn: 'selectProvider',
      selectOp: 'registryKeys',
      request: { url: 'http://localhost/id' },
    })
      .then((v) => {
        expect((v.outcome as { keys: string[] }).keys).to.deep.equal(['fake', 'zitadel']);
        return callService({
          fn: 'selectProvider',
          selectOp: 'fakeSingleton',
          request: { url: 'http://localhost/id' },
        });
      })
      .then((v) => {
        expect((v.outcome as { same: boolean }).same).to.equal(true);
        return callService({
          fn: 'selectProvider',
          selectOp: 'fakeIsInstance',
          request: { url: 'http://localhost/id' },
        });
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
