// cypress/component/resources/shared/lifetimes.cy.ts
//
// Component (no-mount) port of app/resources/shared/__tests__/lifetimes.test.ts.
// Pure freshness-window helpers → browser-side Chai only.
import type { Factors } from '@/modules/auth/types';
import { isFactorFresh, primaryFresh } from '@/resources/shared/lifetimes';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const at = (iso: string | null) => ({ verifiedAt: iso === null ? null : new Date(iso) });

describe('isFactorFresh', () => {
  it('is true inside the window', () => {
    expect(isFactorFresh(at('2026-01-01T00:00:00.000Z'), T0 + 500, 1000)).to.equal(true);
  });
});

describe('primaryFresh / secondFactorFresh / passwordlessPasskeyFresh', () => {
  const fresh = '2026-01-01T00:00:00.000Z';
  it('primaryFresh true if any of password/passkey/idp is fresh', () => {
    const f: Factors = { password: at(fresh) };
    expect(primaryFresh(f, T0 + 100, 1000)).to.equal(true);
    expect(primaryFresh({ idpIntent: at(fresh) }, T0 + 100, 1000)).to.equal(true);
    expect(primaryFresh({}, T0 + 100, 1000)).to.equal(false);
  });
});
