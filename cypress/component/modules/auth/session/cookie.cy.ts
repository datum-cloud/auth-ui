// cypress/component/modules/auth/session/cookie.cy.ts
//
// Node-bound (cy.task) port of app/modules/auth/session/__tests__/cookie.test.ts.
//
// The `sessions` cookie layer (serializeSessions + sessionsCookie.parse) is the SECURITY signing
// boundary: real HMAC, 2048-byte overflow cap, and cross-replica shared-secret verification. The
// cookie module is stubbed out of the Vite browser bundle, so the REAL serialize/parse runs in Bun
// via cy.task; the spec keeps every Chai assertion.
import { callService } from '../../../../support/node/call-service';

describe('cookie layer', () => {
  // The three ops chain in one test, matching the established cy.task chaining pattern. Each
  // callService spawns a fresh Bun process, so they stay fully independent; the only cost is
  // that an earlier failure masks the later results. The TAMPER check therefore runs FIRST —
  // it is the signature-verification assertion, and it must never be the one that gets masked.
  it('rejects a tampered cookie, round-trips a session list, and caps the value at 2048 bytes', () => {
    callService({
      fn: 'cookieRoundTripCheck',
      cookieOp: 'tampered',
      request: { url: 'http://localhost/id' },
    })
      .then((v) => {
        expect((v.outcome as { result: string[] }).result, 'tampered: parses to []').to.deep.equal(
          []
        );
        return callService({
          fn: 'cookieRoundTripCheck',
          cookieOp: 'roundTrip2',
          request: { url: 'http://localhost/id' },
        });
      })
      .then((v) => {
        expect((v.outcome as { ids: string[] }).ids, 'roundTrip2: ids survive').to.deep.equal([
          's1',
          's2',
        ]);
        return callService({
          fn: 'cookieRoundTripCheck',
          cookieOp: 'overflow',
          request: { url: 'http://localhost/id' },
        });
      })
      .then((v) => {
        const o = v.outcome as {
          bytes: number;
          parsedIds: string[];
          expectedIds: string[];
          parsedLen: number;
        };
        expect(o.bytes, 'overflow: bytes <= 2048').to.be.at.most(2048);
        expect(o.parsedIds, 'overflow: only newest entries survive').to.deep.equal(o.expectedIds);
        expect(o.parsedLen, 'overflow: fewer than the 10 written').to.be.lessThan(10);
      });
  });
});
