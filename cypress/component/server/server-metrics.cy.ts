// cypress/component/server/server-metrics.cy.ts
// CY-TASK port of app/__tests__/server.test.ts
//
// Regression guard for the /metrics trust boundary. The real prom-client registry +
// Hono app run in Bun (observability is stubbed to {} in the Vite browser bundle).
// Pinning test: /metrics is reachable WITHOUT auth and returns 200 with 'auth_events_total'.
// If someone adds authentication to /metrics, this test fails and forces a conscious
// decision about the gateway-policy trade-off (scraping will break).
import { callService } from '../../support/node/call-service';

describe('/metrics trust boundary', () => {
  it('GET /metrics is reachable without auth (gateway-internal trust boundary)', () => {
    callService({ fn: 'serverMetrics' }).then((v) => {
      expect(v.outcome.status).to.equal(200);
      expect(v.outcome.containsMetric).to.equal(true);
    });
  });
});
