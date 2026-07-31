// cypress/component/modules/auth/session/passkey-hint.cy.ts
//
// Node-bound (cy.task) spec — passkey-hint.ts is signed with SESSION_SECRET (env.server is
// stubbed out of the browser bundle), so the REAL serialize→parse round-trip runs in Bun.
import { callService } from '../../../../support/node/call-service';

describe('passkey-hint cookie', () => {
  it('round-trips a loginName through serialize → parse, and returns null when absent', () => {
    callService({
      fn: 'passkeyHintCheck',
      passkeyHintOp: 'roundTrip',
      request: { url: 'http://localhost/id' },
    })
      .then((v) => {
        expect((v.outcome as { parsed: string }).parsed).to.equal('alice@acme.test');
        return callService({
          fn: 'passkeyHintCheck',
          passkeyHintOp: 'absent',
          request: { url: 'http://localhost/id' },
        });
      })
      .then((v) => {
        expect((v.outcome as { parsed: string | null }).parsed).to.be.null;
      });
  });

  it('clear expires immediately; attrs pin Path=/id, HttpOnly, and the 7-day Max-Age', () => {
    callService({
      fn: 'passkeyHintCheck',
      passkeyHintOp: 'clear',
      request: { url: 'http://localhost/id' },
    })
      .then((v) => {
        expect((v.outcome as { setCookie: string }).setCookie).to.include('Max-Age=0');
        return callService({
          fn: 'passkeyHintCheck',
          passkeyHintOp: 'attrs',
          request: { url: 'http://localhost/id' },
        });
      })
      .then((v) => {
        const sc = (v.outcome as { setCookie: string }).setCookie;
        expect(sc).to.include('Path=/id');
        expect(sc).to.include('HttpOnly');
        expect(sc).to.include('Max-Age=604800');
      });
  });
});
