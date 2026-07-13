// cypress/component/modules/auth/session/last-used-login.cy.ts
//
// Node-bound (cy.task) port of app/modules/auth/session/__tests__/last-used-login.test.ts.
//
// last-used-login.ts is signed with SESSION_SECRET (via env.server, stubbed out of the browser
// bundle), so the REAL serialize→parse round-trip + absent branch run in Bun via cy.task.
import { callService } from '../../../../support/node/call-service';

describe('last-used-login cookie', () => {
  it('round-trips a token through serialize → parse, and returns null when the cookie is absent', () => {
    callService({
      fn: 'lastUsedLoginCheck',
      lastUsedOp: 'roundTripIdp',
      request: { url: 'http://localhost/id' },
    })
      .then((v) => {
        expect((v.outcome as { parsed: string }).parsed).to.equal('idp:g');
        return callService({
          fn: 'lastUsedLoginCheck',
          lastUsedOp: 'absent',
          request: { url: 'http://localhost/id' },
        });
      })
      .then((v) => {
        expect((v.outcome as { parsed: string | null }).parsed).to.be.null;
      });
  });
});
