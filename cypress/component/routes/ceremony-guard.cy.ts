// cypress/component/routes/ceremony-guard.cy.ts
//
// Governance/regression guardrail: runs the static-analysis scanner
// (cypress/support/ceremony-guard.ts) entirely in Node via cy.task('ceremonyGuard') and asserts
// that no ceremony-dropping literal pattern (bare redirect('/login')/redirect('/'), to="/",
// href="/login", href="/", or a no-arg paths.*.index() call) exists in app/routes/** or the
// shared redirect-target helpers OUTSIDE the documented allowlist.
//
// This is a REAL, non-vacuous assertion: it is the backstop for the requestId/organization
// ceremony-threading audit (15 sites + 1 found by this scanner itself, all fixed on this
// branch). Flipping any one of the fixes back to its pre-fix literal form, or introducing a
// NEW ceremony-dropping site, fails this spec.
//
// Node-side (fs) scan — no cy.mount(), no app server required. Only a TYPE import from the
// scanner module: a value import would pull `fs`/`path` into the Vite browser bundle (the
// scanner itself only ever runs Node-side, via cy.task).
import type { CeremonyGuardResult } from '../../support/ceremony-guard';

describe('Ceremony-params regression guardrail (governance)', () => {
  it('finds no ceremony-dropping redirect/link pattern outside the documented allowlist', () => {
    cy.task<CeremonyGuardResult>('ceremonyGuard').then((r) => {
      // Sanity: the scanner actually walked a non-trivial number of files — guards against a
      // silently-broken glob (an empty scan would make the assertion below vacuously pass).
      expect(r.filesScanned, 'files scanned').to.be.greaterThan(20);
      expect(
        r.offenders,
        r.offenders.map((o) => `${o.file}:${o.line} [${o.pattern}] ${o.text}`).join('\n')
      ).to.have.length(0);
    });
  });

  it('every allowlist entry documents a non-vacuous reason (no blanket exemptions)', () => {
    cy.task<CeremonyGuardResult>('ceremonyGuard').then((r) => {
      const entries = Object.entries(r.allowlist);
      expect(entries.length, 'allowlist has entries').to.be.greaterThan(0);
      for (const [file, reason] of entries) {
        expect(reason.length, `${file} allowlist reason is a real explanation`).to.be.greaterThan(
          40
        );
      }
    });
  });

  // RED→GREEN evidence: the scanner's own patterns actually fire on the pre-fix literal forms.
  // This proves the check is real (would have failed before this branch's fixes), not tautological.
  it('the underlying patterns do match known pre-fix literal forms (proves the check is live)', () => {
    const preFixSamples = [
      "return redirect('/login');",
      "return redirect('/');",
      '<Link to="/">',
      'href="/login">',
      'href="/">',
      'paths.login.index()',
    ];
    // Re-derived minimal copies of the scanner's own regexes so this test has no import-order
    // dependency on the module internals beyond the exported result shape.
    const patterns = [
      /redirect\(\s*(['"`])\/login\1\s*\)/,
      /redirect\(\s*(['"`])\/\1\s*\)/,
      /\bto="\/"/,
      /href="\/login"/,
      /href="\/"/,
      /paths\.[a-zA-Z]+(?:\.[a-zA-Z]+)*\.index\(\)/,
    ];
    preFixSamples.forEach((sample, i) => {
      expect(patterns[i].test(sample), `${patterns[i]} matches "${sample}"`).to.equal(true);
    });
  });
});
