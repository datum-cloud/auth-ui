// cypress/component/server/timing.cy.ts
// COMPONENT port of app/server/__tests__/timing.test.ts
// Pure function with injectable sleep — no node deps.
import { constantTimeNoop, CONSTANT_TIME_FLOOR_MS } from '@/server/timing';

describe('constantTimeNoop', () => {
  it('waits the configured floor delay, not a single tick', () => {
    const sleeps: number[] = [];
    const fakeSleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    return constantTimeNoop(fakeSleep).then(() => {
      expect(CONSTANT_TIME_FLOOR_MS).to.be.greaterThan(0);
      expect(sleeps).to.deep.equal([CONSTANT_TIME_FLOOR_MS]);
    });
  });
});
