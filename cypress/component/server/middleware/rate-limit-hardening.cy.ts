// cypress/component/server/middleware/rate-limit-hardening.cy.ts
//
// The password and signup limiters key their tight tier on `?loginName=` from the QUERY STRING,
// while the action authenticates the loginName from the POST BODY. Rotating the query param used
// to hand every attempt a fresh bucket. These cases drive both tiers together, mounted the way
// app/server.ts mounts them, and prove the ip-only ceiling still answers 429.
import { callService } from '../../../support/node/call-service';

describe('loginPasswordIpRateLimit — ip-only ceiling under a rotating ?loginName', () => {
  it('lets 30 password POSTs through, then 429s the 31st even though every loginName differs', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'passwordIpCeiling' }).then((v) => {
      expect(v.outcome.underCeilingPassed, 'a NAT gets 30 attempts per 5 min').to.equal(true);
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
    });
  });

  it('keeps the per-account tier: one loginName still stops at 5', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'passwordTightTierStillPerAccount' }).then(
      (v) => {
        expect(v.outcome.statuses).to.deep.equal([200, 200, 200, 200, 200, 429]);
      }
    );
  });
});

describe('signupIpRateLimit — ip-only ceiling under a rotating ?loginName', () => {
  it('lets 20 signup POSTs through, then 429s the 21st even though every loginName differs', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'signupIpCeiling' }).then((v) => {
      expect(v.outcome.underCeilingPassed).to.equal(true);
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
    });
  });
});

describe('the new ceilings are mounted', () => {
  it('app/server.ts mounts both ip-only tiers', () => {
    // A limiter that is defined but never mounted throttles nothing.
    callService({ fn: 'hardeningCheck', hardeningOp: 'serverMountsHardeningLimiters' }).then(
      (v) => {
        expect(v.outcome.passwordIp).to.equal(true);
        expect(v.outcome.signupIp).to.equal(true);
      }
    );
  });
});
