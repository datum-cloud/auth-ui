// cypress/component/modules/auth/provider-registry.cy.ts
//
// Node-bound (cy.task) port of app/modules/auth/__tests__/provider-registry.test.ts.
//
// providerRegistry lives in select.server.ts, which is stubbed (fake-only) in the Vite browser
// bundle — so the "exactly fake + zitadel" binding-point assertion would be vacuous in the browser.
// The REAL registry (both binding points + the fake process-singleton) runs in Bun via cy.task.
import { callService } from '../../../support/node/call-service';

describe('providerRegistry — one binding point', () => {
  it('has exactly the fake and zitadel modes, and the fake entry is a process-stable singleton', () => {
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
      });
  });
});
