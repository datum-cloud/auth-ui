// cypress/component/resources/shared/lifetimes.cy.ts
//
// Component (no-mount) port of app/resources/shared/__tests__/lifetimes.test.ts.
// Pure freshness-window helpers → browser-side Chai only.
import type { Factors } from '@/modules/auth/types';
import { isFactorFresh, primaryFresh } from '@/resources/shared/lifetimes';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const at = (iso: string | null) => ({ verifiedAt: iso === null ? null : new Date(iso) });

describe('isFactorFresh / primaryFresh', () => {
  const fresh = '2026-01-01T00:00:00.000Z';

  // Both directions. Only the `true` branch was covered before, so an implementation that
  // returned true unconditionally — the fail-OPEN direction, where a stale factor is treated
  // as fresh and a re-auth prompt is skipped — would have passed.
  const FRESHNESS: Array<
    [
      label: string,
      verifiedAt: string | null,
      nowMs: number,
      lifetimeMs: number | undefined,
      expected: boolean,
    ]
  > = [
    ['inside the window', fresh, T0 + 500, 1000, true],
    // Boundary is inclusive (nowMs - verifiedMs <= lifetimeMs), so the edge is still fresh.
    ['exactly at the window edge', fresh, T0 + 1000, 1000, true],
    ['one millisecond past the edge', fresh, T0 + 1001, 1000, false],
    ['well past the window', fresh, T0 + 5000, 1000, false],
    ['never verified (null)', null, T0 + 100, 1000, false],
    // No lifetime configured means the factor never expires — a distinct branch from
    // "inside the window", and the one that decides whether a re-auth prompt appears at all.
    ['no lifetime configured (undefined)', fresh, T0 + 999_999, undefined, true],
    [
      'zero lifetime is treated as "never expires", not "always stale"',
      fresh,
      T0 + 999_999,
      0,
      true,
    ],
  ];

  it('treats a factor as fresh up to and including its window edge, stale past it, and never-expiring when no lifetime is configured; primaryFresh is true if ANY of password/passkey/idp is fresh', () => {
    for (const [label, verifiedAt, nowMs, lifetimeMs, expected] of FRESHNESS) {
      expect(isFactorFresh(at(verifiedAt), nowMs, lifetimeMs), label).to.equal(expected);
    }

    const f: Factors = { password: at(fresh) };
    expect(primaryFresh(f, T0 + 100, 1000), 'password fresh').to.equal(true);
    expect(primaryFresh({ idpIntent: at(fresh) }, T0 + 100, 1000), 'idpIntent fresh').to.equal(
      true
    );
    expect(primaryFresh({}, T0 + 100, 1000), 'no factors at all').to.equal(false);
  });
});
