// cypress/component/server/hash-actor.cy.ts
// hashActor is the audit log's actor pseudonym. It runs in Node through the harness because the
// browser bundle stubs observability (hashActor → ''). run-scenario.ts pins SESSION_SECRET, so
// every scenario derives the same key and the output is stable across runs.
import { callService } from '../../support/node/call-service';

describe('hashActor', () => {
  it('is 16 hex chars and stable for a fixed secret', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'hashActorDeterministic' }).then(
      (v) => {
        expect(v.outcome.matchesHex16).to.equal(true);
        expect(v.outcome.stable).to.equal(true);
      }
    );
  });

  it('is an HMAC under the HKDF-derived key, not a plain sha256 of the login name', () => {
    callService({ fn: 'hashActorKeyedCheck' }).then((v) => {
      expect(v.outcome.matchesKeyedHmac).to.equal(true);
      expect(v.outcome.differsFromSha256).to.equal(true);
    });
  });

  it('gives different pseudonyms for different login names and never echoes the input', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'hashActorDiverse' }).then((v) => {
      expect(v.outcome.differs).to.equal(true);
      expect(v.outcome.noEcho).to.equal(true);
    });
  });

  it("returns '' for an empty login name", () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'hashActorEmpty' }).then((v) => {
      expect(v.outcome.result).to.equal('');
    });
  });
});
