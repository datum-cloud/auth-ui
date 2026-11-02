// cypress/component/server/middleware/audit-limiter-inventory.cy.ts
//
// The limiter inventory in cypress/support/audit-coverage.ts: every route that exports an action
// (a POST handler) must be counted by a mounted limiter or excused with a reason. The e2e
// audit-coverage spec asserts the live result; this spec also proves the scan FAILS when it should.
import { callService } from '../../../support/node/call-service';

describe('POST-route limiter inventory', () => {
  it('passes on the real route tree, with both device routes throttled', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'limiterInventoryLive' }).then((v) => {
      expect(v.outcome.failures, JSON.stringify(v.outcome.failures)).to.have.length(0);
      expect(v.outcome.count, 'it actually found the action routes').to.be.greaterThan(20);
      expect(v.outcome.deviceIndex).to.deep.equal({ key: 'device/index.tsx', ok: true });
      expect(v.outcome.deviceAuthorize).to.deep.equal({ key: 'device/authorize.tsx', ok: true });
    });
  });

  it('fails a POST route no limiter claims, and a claimed limiter that is not mounted', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'limiterInventoryNegative' }).then((v) => {
      expect(v.outcome.unclaimed.ok).to.equal(false);
      expect(v.outcome.unclaimed.reason).to.contain('no rate limiter claims it');
      expect(v.outcome.unmounted.ok).to.equal(false);
      expect(v.outcome.unmounted.reason).to.contain('server.ts does not mount it');
    });
  });
});
