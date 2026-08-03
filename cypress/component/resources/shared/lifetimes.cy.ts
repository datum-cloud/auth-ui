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

  it('reports a factor inside its window as fresh, and primaryFresh is true if ANY of password/passkey/idp is fresh', () => {
    expect(isFactorFresh(at(fresh), T0 + 500, 1000), 'inside the window').to.equal(true);

    const f: Factors = { password: at(fresh) };
    expect(primaryFresh(f, T0 + 100, 1000), 'password fresh').to.equal(true);
    expect(primaryFresh({ idpIntent: at(fresh) }, T0 + 100, 1000), 'idpIntent fresh').to.equal(
      true
    );
    expect(primaryFresh({}, T0 + 100, 1000), 'no factors at all').to.equal(false);
  });
});
