// cypress/support/node/call-service.ts
//
// Browser-side (spec) helper for the node-spec harness. Imports TYPES only from scenario.ts (erased
// at build) and wraps cy.task('callService', ...) with the Scenario/Verdict contract, so specs read
// like ordinary unit tests: build a scenario, get back a verdict, assert with Chai.
import type { AuditEvent, Scenario, Verdict } from './scenario';

// Spec-side view of a verdict: outcome is widened to `any` so callers can freely drill into
// nested properties (e.g. v.outcome.line.event) and cast to domain types without extra casts.
// The harness still enforces the Record<string, unknown> shape; the relaxation is local to specs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpecVerdict = Omit<Verdict, 'outcome'> & { outcome: any };

/** Drive a real cookie/session/audit-dependent service in Bun and return the serialized verdict. */
export function callService(scenario: Scenario): Cypress.Chainable<SpecVerdict> {
  return cy.task<Verdict>('callService', scenario).then((verdict) => {
    // Fail loudly if the runner itself errored — keeps a harness misconfig from masquerading as a
    // passing assertion on an undefined field.
    expect(verdict.ok, verdict.error ? `runner error: ${verdict.error}` : 'runner ok').to.equal(
      true
    );
    return verdict as SpecVerdict;
  });
}

export type { AuditEvent, Scenario, Verdict };
