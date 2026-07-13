/**
 * Auth-event audit coverage — governance e2e spec.
 *
 * Runs the static-analysis scanner entirely in Node via cy.task('auditCoverage')
 * and asserts the three governance guarantees:
 *   1. Every audited route has logAuthEvent coverage (inline or via delegated factory).
 *   2. Every REQUIRED_EVENTS name is emitted at a logAuthEvent call site.
 *   3. No logAuthEvent call passes raw PII (loginName / email object keys).
 *
 * This spec does NOT navigate to any page — it only uses cy.task, so it does
 * not require the app server to be running. It is intentionally placed in
 * cypress/e2e/ (not cypress/component/) because the scanner uses Node fs APIs
 * and cannot run inside the browser bundle.
 */
import type { AuditCoverageResult, RouteCoverageEntry } from '../support/audit-coverage';

describe('Auth-event audit coverage (governance)', () => {
  it('every audited route has logAuthEvent coverage, registry is complete, no PII', () => {
    cy.task<AuditCoverageResult>('auditCoverage').then((r) => {
      const failedRoutes = r.routeCoverage.filter((x: RouteCoverageEntry) => !x.ok);
      expect(failedRoutes, JSON.stringify(failedRoutes)).to.have.length(0);
      expect(r.missingEvents, r.missingEvents.join(', ')).to.have.length(0);
      expect(r.piiOffenders, r.piiOffenders.join('\n')).to.have.length(0);
    });
  });
});
