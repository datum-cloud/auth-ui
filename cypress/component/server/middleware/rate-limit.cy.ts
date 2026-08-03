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

describe('loginIdentifierRateLimit — POST /id/login', () => {
  it('blocks the 121st identifier submit from one IP (limit=120)', () => {
    // This endpoint mints the ceremony session /id/login/method's gate demands, so leaving it
    // unthrottled let a prober self-issue a cookie for every probed address. It is also the
    // endpoint that reveals existence directly when ignoreUnknownUsernames is off.
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginIdentifierBlocked' }).then((v) => {
      expect(v.outcome.allPassed, 'a busy NAT gets 120 submits per 5 min').to.equal(true);
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
      // RR7 submits the hydrated action to /id/login.data — it must share the bucket, not slip
      // past the matcher (the bypass class net.ts's normalizedPathname exists to close).
      expect(v.outcome.dataVariantStatus, '.data shares the budget').to.equal(429);
      // Only the submit is state-changing; rendering the form must never spend anyone's budget.
      expect(v.outcome.getStatus, 'a GET is not counted').to.equal(200);
    });
  });
});

describe('loginMethodIntentRateLimit — tight (ip|loginName) tier', () => {
  it('blocks the 11th identified GET for the SAME loginName (limit=10)', () => {
    // GET /id/login/method?loginName=X mints a real IdP intent and 302s to the provider for a
    // sole-linked-IdP account. The tight tier bounds how many intents one address can cost.
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginMethodIntentBlocked' }).then((v) => {
      expect(v.outcome.allPassed).to.equal(true);
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
    });
  });

  it('keys per loginName — one exhausted account does not lock out the next from that IP', () => {
    // The point of the two-tier split: a NAT'd office shares an egress IP, so a per-ip-only
    // budget would let one hammered account 429 everybody else's sign-in.
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginMethodIntentPerLoginName' }).then(
      (v) => {
        expect(v.outcome.aliceStatus, 'the exhausted account stays blocked').to.equal(429);
        expect(v.outcome.bobStatus, 'a different account still gets through').to.equal(200);
      }
    );
  });

  it('never counts a GET without (or with an empty) ?loginName — it mints nothing', () => {
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginMethodBareGetNoConsume' }).then((v) => {
      expect(v.outcome.identifiedStatus).to.equal(200);
    });
  });
});

describe('loginMethodIntentIpRateLimit — loose ip-only ceiling', () => {
  it('blocks the 121st GET from one IP even when every loginName differs (limit=120)', () => {
    // Keying only by (ip, loginName) would hand an enumerator a fresh bucket per probed
    // address; the ip ceiling is what still bounds enumeration BREADTH.
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginMethodIntentIpCeiling' }).then((v) => {
      expect(v.outcome.allPassed).to.equal(true);
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
    });
  });
});

describe('rate-limited top-level navigation → HTML, not raw JSON', () => {
  it('answers a GET document request with a rendered 429 page', () => {
    // The chooser GET is a page load: a raw {"error":"RATE_LIMITED"} body is what the user
    // would see in the browser window.
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginMethodIntentHtml429' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(String(v.outcome.contentType)).to.contain('text/html');
      expect(v.outcome.hasHeading, 'renders a real heading').to.equal(true);
      expect(v.outcome.hasBackLink, 'offers a way back to sign in').to.equal(true);
      expect(v.outcome.isRawJson).to.equal(false);
    });
  });

  it('keeps the JSON body for the single-fetch .data variant', () => {
    // Consumed by code (a fetcher/action result), not rendered — every other limiter in the
    // file returns this shape and callers parse it.
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'loginMethodIntentDataJson429' }).then((v) => {
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(String(v.outcome.contentType)).to.contain('application/json');
      expect(v.outcome.error).to.equal('RATE_LIMITED');
    });
  });
});

describe('chooser GET limiters are actually mounted', () => {
  it('app/server.ts imports and mounts BOTH tiers, and the identifier POST ceiling', () => {
    // A limiter that is defined but never mounted throttles nothing.
    callService({ fn: 'rateLimitCheck', rateLimitOp: 'serverMountsChooserLimiters' }).then((v) => {
      expect(v.outcome.tightTierMounted).to.equal(true);
      expect(v.outcome.ipTierMounted).to.equal(true);
      // The three guard one ceremony together: the identifier POST hands out the session the
      // chooser GET's gate demands, so an unmounted limiter there undercuts both tiers above.
      expect(v.outcome.identifierMounted).to.equal(true);
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
