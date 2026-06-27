// cypress/component/server/observability.cy.ts
// CY-TASK port of app/server/__tests__/observability.test.ts
// Real observability module — not the Vite stub. ALS + prom-client run in Bun.
import { callService } from '../../support/node/call-service';

describe('hashActor', () => {
  it('returns a stable 16-char hex string for the same input', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'hashActorDeterministic' }).then(
      (v) => {
        expect(v.outcome.matchesHex16).to.equal(true);
        expect(v.outcome.stable).to.equal(true);
      }
    );
  });

  it('produces distinct hashes for different inputs and does not echo the input', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'hashActorDiverse' }).then((v) => {
      expect(v.outcome.differs).to.equal(true);
      expect(v.outcome.noEcho).to.equal(true);
    });
  });

  it('handles an empty string without throwing', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'hashActorEmpty' }).then((v) => {
      expect(v.outcome.result).to.be.a('string');
    });
  });
});

describe('logAuthEvent — Prometheus metric', () => {
  it('increments the auth_events_total counter', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'logAuthEventMetric' }).then((v) => {
      expect(v.outcome.containsMetric).to.equal(true);
    });
  });
});

describe('logAuthEvent — audit line', () => {
  it('calls the injected sink with a JSON line', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'logAuthEventAuditLine' }).then(
      (v) => {
        expect(v.outcome.sinkCalled).to.equal(true);
        expect(v.outcome.line.event).to.equal('password_check');
        expect(v.outcome.line.outcome).to.equal('success');
        expect(v.outcome.line.userId).to.equal('u1');
      }
    );
  });

  it('includes an explicit traceId when provided in ctx', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'logAuthEventExplicitTrace' }).then(
      (v) => {
        expect(v.outcome.sinkCalled).to.equal(true);
        expect(v.outcome.line.traceId).to.equal('550e8400-e29b-41d4-a716-446655440000');
      }
    );
  });

  it('reads the traceId from ALS when not passed explicitly', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'logAuthEventAlsTrace' }).then((v) => {
      expect(v.outcome.traceId).to.equal('als-real-00000000-0000-4000-a000-000000000002');
    });
  });

  it('omits traceId key entirely when no trace context exists', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'logAuthEventNoTrace' }).then((v) => {
      expect(v.outcome.sinkCalled).to.equal(true);
      // logAuthEvent uses `{}` spread when ALS is empty → traceId key must be ABSENT (not just
      // undefined). hasTraceIdKey is computed node-side via hasOwnProperty before JSON serialization
      // so the distinction survives the cy.task boundary (JSON.stringify drops undefined values).
      expect(v.outcome.hasTraceIdKey).to.equal(false);
    });
  });

  it('uses the default auditSink (console.log) when no sink is injected', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'auditSinkDefault' }).then((v) => {
      expect(v.outcome.line).to.not.be.null;
      expect(v.outcome.line.event).to.equal('password_check');
    });
  });
});

describe('getTraceId outside a runWithTraceId context', () => {
  it('returns undefined', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'getTraceIdOutside' }).then((v) => {
      expect(v.outcome.result).to.be.undefined;
    });
  });
});

describe('auditSink', () => {
  it('is a function (default sink = console.log wrapper)', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'auditSinkIsFunction' }).then((v) => {
      expect(v.outcome.isFunction).to.equal(true);
    });
  });
});

describe('httpRequestDuration histogram', () => {
  it('records a sample with the expected labels', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'httpDurationMetric' }).then((v) => {
      expect(v.outcome.containsMetric).to.equal(true);
      expect(v.outcome.hasMethod).to.equal(true);
      expect(v.outcome.hasRoute).to.equal(true);
      expect(v.outcome.hasStatus).to.equal(true);
    });
  });
});

describe('httpMetrics middleware', () => {
  it('still calls end() and re-throws when the downstream handler throws', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'httpMetricsThrowing' }).then((v) => {
      expect(v.outcome.threw).to.equal(true);
      expect(v.outcome.endCalled).to.equal(true);
    });
  });
});
