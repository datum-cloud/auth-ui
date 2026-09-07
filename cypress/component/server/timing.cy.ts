// cypress/component/server/timing.cy.ts
// COMPONENT port of app/server/__tests__/timing.test.ts
// Pure function with injectable sleep — no node deps.
import { constantTimeNoop, waitUntilDeadline, CONSTANT_TIME_FLOOR_MS } from '@/server/timing';

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

// waitUntilDeadline is what the signup code branch uses instead of constantTimeNoop. The
// difference is the whole point: a FLOOR adds a fixed delay regardless of what the branch already
// spent, so a branch that pads and a branch that does not diverge by however much the unpadded one
// costs — and when the unpadded work is FASTER than the floor (the common case for a healthy
// provider) the padded branch becomes reliably slower, inverting the channel instead of closing
// it. A DEADLINE subtracts the elapsed time, so every branch leaves at the same mark.
describe('waitUntilDeadline', () => {
  function record() {
    const sleeps: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    return { sleeps, sleep };
  }

  it('sleeps only the REMAINDER of the floor, not the whole floor', () => {
    const { sleeps, sleep } = record();
    // 40ms already spent → 110ms left of a 150ms deadline. A floor would have slept all 150.
    return waitUntilDeadline(1_000, { sleep, now: () => 1_040, floorMs: 150 }).then(() => {
      expect(sleeps).to.deep.equal([110]);
    });
  });

  it('lands two branches of different cost on the same deadline', () => {
    const fast = record();
    const slow = record();
    return waitUntilDeadline(0, { sleep: fast.sleep, now: () => 5, floorMs: 150 })
      .then(() => waitUntilDeadline(0, { sleep: slow.sleep, now: () => 120, floorMs: 150 }))
      .then(() => {
        expect(5 + fast.sleeps[0]).to.equal(120 + slow.sleeps[0]);
      });
  });

  it('never sleeps a negative duration when the work already overran the floor', () => {
    const { sleeps, sleep } = record();
    return waitUntilDeadline(0, { sleep, now: () => 900, floorMs: 150 }).then(() => {
      expect(sleeps).to.deep.equal([0]);
    });
  });

  it('defaults to the shared constant-time floor', () => {
    const { sleeps, sleep } = record();
    return waitUntilDeadline(1_000, { sleep, now: () => 1_000 }).then(() => {
      expect(sleeps).to.deep.equal([CONSTANT_TIME_FLOOR_MS]);
    });
  });
});
