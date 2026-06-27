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
  it('round-trips a session list through serialize → parse', () => {
    callService({
      fn: 'cookieRoundTripCheck',
      cookieOp: 'roundTrip2',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      expect((v.outcome as { ids: string[] }).ids).to.deep.equal(['s1', 's2']);
    });
  });

  it('returns [] for a tampered cookie value (invalid signature)', () => {
    callService({
      fn: 'cookieRoundTripCheck',
      cookieOp: 'tampered',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      expect((v.outcome as { result: string[] }).result).to.deep.equal([]);
    });
  });

  it('overflow: serialized value ≤ 2048 bytes and only newest entries survive', () => {
    callService({
      fn: 'cookieRoundTripCheck',
      cookieOp: 'overflow',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      const o = v.outcome as {
        bytes: number;
        parsedIds: string[];
        expectedIds: string[];
        parsedLen: number;
      };
      expect(o.bytes).to.be.at.most(2048);
      expect(o.parsedIds).to.deep.equal(o.expectedIds);
      expect(o.parsedLen).to.be.lessThan(10);
    });
  });

  it('single entry whose serialized size alone exceeds 2048 bytes parses back to []', () => {
    callService({
      fn: 'cookieRoundTripCheck',
      cookieOp: 'giant',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      const o = v.outcome as { bytes: number; parsedLen: number };
      expect(o.bytes).to.be.at.most(2048);
      expect(o.parsedLen).to.equal(0);
    });
  });

  it('cross-replica: cookie signed by replica-A parses correctly on replica-B (same shared secret)', () => {
    callService({
      fn: 'cookieRoundTripCheck',
      cookieOp: 'crossReplica',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      const o = v.outcome as { count: number; firstId: string };
      expect(o.count).to.equal(1);
      expect(o.firstId).to.equal('x1');
    });
  });
});
