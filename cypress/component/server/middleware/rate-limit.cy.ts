// cypress/component/server/middleware/rate-limit.cy.ts
// CY-TASK port of app/server/middleware/__tests__/rate-limit.test.ts
// Each cy.task = fresh Bun process → clean RateLimiter state; Date.now overridden per-case.
import { callService } from '../../../support/node/call-service';

// ── loginPasswordRateLimit ──────────────────────────────────────────────────
describe('loginPasswordRateLimit', () => {
  it('blocks the 6th POST from the same IP (limit=5)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginPasswordBlocked' }).then((v) => {
      expect(v.outcome.allPassed).to.equal(true);
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
      expect(v.outcome.error).to.be.a('string');
    });
  });

  it('GET requests do not consume the POST budget', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginPasswordGetNoConsume' }).then((v) => {
      expect(v.outcome.postStatus).to.equal(200);
    });
  });

  it('trailing-slash path shares the same bucket as the canonical path', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginPasswordTrailingSlash' }).then((v) => {
      expect(v.outcome.fifthStatus).to.equal(200);
      expect(v.outcome.sixthStatus).to.equal(429);
    });
  });

  it('keying is on the last XFF hop, not on the rotating proxies', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginPasswordXffRotation' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
    });
  });
});

// ── webauthnVerifyRateLimit ─────────────────────────────────────────────────
describe('webauthnVerifyRateLimit', () => {
  it('blocks the 11th POST from the same IP (limit=10)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'webauthnBlocked' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
      expect(v.outcome.error).to.be.a('string');
    });
  });

  it('security-key, mfa, and passkey share the same bucket', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'webauthnSharedBucket' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
    });
  });

  it('/login/password POSTs do not consume the webauthn budget', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'webauthnPasswordNoConsume' }).then((v) => {
      expect(v.outcome.passkeyStatus).to.equal(200);
    });
  });

  it('GET requests do not consume the webauthn budget', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'webauthnGetNoConsume' }).then((v) => {
      expect(v.outcome.postStatus).to.equal(200);
    });
  });

  it('trailing-slash path shares the same bucket', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'webauthnTrailingSlash' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
    });
  });
});

// ── mfaEnrollRateLimit ──────────────────────────────────────────────────────
describe('mfaEnrollRateLimit', () => {
  it('blocks the 16th POST from the same IP (limit=15)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'mfaEnrollBlocked' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.error).to.be.a('string');
    });
  });

  it('passkey, security-key, authenticator, email, sms and mfa share one bucket', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'mfaEnrollSharedPaths' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
    });
  });

  it('GET requests do not consume the MFA enroll budget', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'mfaEnrollGetNoConsume' }).then((v) => {
      expect(v.outcome.postStatus).to.equal(200);
    });
  });
});

// ── accountsRateLimit ───────────────────────────────────────────────────────
describe('accountsRateLimit', () => {
  it('blocks the 16th POST from the same IP (limit=15)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'accountsBlocked' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.error).to.be.a('string');
    });
  });

  it('GET requests do not consume the accounts budget', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'accountsGetNoConsume' }).then((v) => {
      expect(v.outcome.postStatus).to.equal(200);
    });
  });

  it('different IPs have isolated buckets', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'accountsIsolatedIps' }).then((v) => {
      expect(v.outcome.blockedA).to.equal(429);
      expect(v.outcome.allowedB).to.equal(200);
    });
  });
});

// ── verifyEmailSendRateLimit ────────────────────────────────────────────────
describe('verifyEmailSendRateLimit', () => {
  it('blocks the 11th ?send=true GET from the same IP (limit=10)', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'verifyEmailBlocked' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.error).to.be.a('string');
    });
  });

  it('GETs without ?send=true do not consume the budget', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'verifyEmailNoSendNoConsume' }).then((v) => {
      expect(v.outcome.sendStatus).to.equal(200);
    });
  });

  it('POST requests do not consume the send budget', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'verifyEmailPostNoConsume' }).then((v) => {
      expect(v.outcome.allPassed).to.equal(true);
    });
  });
});
