// cypress/component/server/middleware/rate-limit.cy.ts
// CY-TASK port of app/server/middleware/__tests__/rate-limit.test.ts
// Each cy.task = fresh Bun process → clean RateLimiter state; Date.now overridden per-case.
// Reduced to one "limit enforced" case per distinct rate-limited route — each is a genuine
// abuse-prevention control guarding a different endpoint. Bucket-sharing/no-consume/isolation
// variants are covered structurally by middleware/rate-limit-store.cy.ts.
import { callService } from '../../../support/node/call-service';

describe('loginPasswordRateLimit', () => {
  it('blocks the 6th POST from the same IP (limit=5)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginPasswordBlocked' }).then((v) => {
      expect(v.outcome.allPassed).to.equal(true);
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
      expect(v.outcome.error).to.be.a('string');
    });
  });
});

describe('webauthnVerifyRateLimit', () => {
  it('blocks the 11th POST from the same IP (limit=10)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'webauthnBlocked' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
      expect(v.outcome.error).to.be.a('string');
    });
  });
});

describe('mfaEnrollRateLimit', () => {
  it('blocks the 16th POST from the same IP (limit=15)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'mfaEnrollBlocked' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.error).to.be.a('string');
    });
  });
});

describe('accountsRateLimit', () => {
  it('blocks the 16th POST from the same IP (limit=15)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'accountsBlocked' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.error).to.be.a('string');
    });
  });
});

describe('verifyEmailSendRateLimit', () => {
  it('blocks the 11th ?send=true GET from the same IP (limit=10)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'verifyEmailBlocked' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.error).to.be.a('string');
    });
  });
});
