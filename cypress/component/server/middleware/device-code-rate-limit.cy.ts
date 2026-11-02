// cypress/component/server/middleware/device-code-rate-limit.cy.ts
//
// RFC 8628 §5.1: the device-flow user code is short and human-typable, and /id/device answers a
// known code differently from an unknown one. deviceCodeRateLimit bounds guessing per IP across
// the code-entry POST, the consent GET that resolves ?user_code=, and the decision POST.
import { callService } from '../../../support/node/call-service';

describe('deviceCodeRateLimit', () => {
  it('lets 10 code resolutions through across the three surfaces, then 429s', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'deviceCodeBlocked' }).then((v) => {
      expect(v.outcome.underLimitPassed, 'a real activation and a few typos fit').to.equal(true);
      expect(v.outcome.blockedStatus).to.equal(429);
      expect(v.outcome.retryAfter).to.be.a('string');
      expect(v.outcome.blockedGetStatus, 'the consent GET shares the budget').to.equal(429);
      expect(v.outcome.dataVariantStatus, 'the single-fetch .data submit shares it').to.equal(429);
    });
  });

  it('never counts rendering the forms (GETs without a user_code)', () => {
    callService({ fn: 'hardeningCheck', hardeningOp: 'deviceCodeBareGetNoConsume' }).then((v) => {
      expect(v.outcome.postStatus).to.equal(200);
    });
  });
});
