// cypress/component/server/observability.cy.ts
// CY-TASK port of app/server/__tests__/observability.test.ts
// Real observability module — not the Vite stub. ALS + prom-client run in Bun.
import { callService } from '../../support/node/call-service';

describe('logAuthEvent', () => {
  it('increments the auth_events_total counter and calls the injected sink with a JSON line', () => {
    callService({ fn: 'observabilityCheck', observabilityOp: 'logAuthEventMetric' }).then((v) => {
      expect(v.outcome.containsMetric).to.equal(true);
    });

    callService({ fn: 'observabilityCheck', observabilityOp: 'logAuthEventAuditLine' }).then(
      (v) => {
        expect(v.outcome.sinkCalled).to.equal(true);
        expect(v.outcome.line.event).to.equal('password_check');
        expect(v.outcome.line.outcome).to.equal('success');
        expect(v.outcome.line.userId).to.equal('u1');
      }
    );
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
