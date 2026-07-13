// cypress/component/server/composition.cy.ts
// CY-TASK port of app/server/__tests__/composition.test.ts
// providerForRequest reads AUTH_PROVIDER env → node-bound.
import { callService } from '../../support/node/call-service';

describe('providerForRequest', () => {
  it('returns a FakeAuthProvider when AUTH_PROVIDER=fake', () => {
    callService({ fn: 'compositionCheck', compositionOp: 'fakeProvider' }).then((v) => {
      expect(v.outcome.isDefined).to.equal(true);
      expect(v.outcome.hasListSessions).to.equal(true);
    });
  });

  it('auth-context.server.ts does not import the Zitadel provider directly', () => {
    callService({ fn: 'compositionCheck', compositionOp: 'noZitadelImport' }).then((v) => {
      expect(v.outcome.containsZitadel).to.equal(false);
    });
  });
});
