// cypress/component/resources/shared/resolve-org.cy.ts
//
// Org-first / default-org fallback resolver (app/resources/shared/resolve-org.ts).
//
// Two layers:
//   • Browser-side (pure): urlOrg-wins, cached-default, caching (called once), null-not-cached.
//     These need in-process call counting + the module cache, so they run in the bundle. The env
//     pin is out of the way here — env.server is stubbed to `{}` in the Vite bundle, so
//     env.ZITADEL_DEFAULT_ORG_ID is undefined.
//   • Node-side (cy.task 'resolveOrgProbe'): the env-pin precedence, which is only reachable when
//     the REAL env schema is loaded (Bun). Each cy.task is a fresh process ⇒ a clean module cache.
import { callService } from '../../../support/node/call-service';
import type { AuthProvider } from '@/modules/auth/auth-provider';
import { resolveOrg, resetDefaultOrgCache } from '@/resources/shared/resolve-org';

/** A minimal AuthProvider whose getDefaultOrg is a counting stub over a mutable return value. */
function stubProvider(ret: () => string | null) {
  let calls = 0;
  const provider = {
    getDefaultOrg: async () => {
      calls += 1;
      return ret();
    },
  } as unknown as AuthProvider;
  return { provider, getCalls: () => calls };
}

describe('resolveOrg — precedence + caching (pure)', () => {
  beforeEach(() => resetDefaultOrgCache());

  it('an explicit urlOrg wins and never consults the provider default', async () => {
    const { provider, getCalls } = stubProvider(() => 'default-org');
    expect(await resolveOrg(provider, 'url-org')).to.equal('url-org');
    expect(getCalls()).to.equal(0);
  });
});

// ── node-side: the env-pin branch (ZITADEL_DEFAULT_ORG_ID), reachable only with the real env ──
describe('resolveOrg — env pin precedence (node-side)', () => {
  it('the ZITADEL_DEFAULT_ORG_ID env pin wins over the provider default org', () => {
    callService({
      fn: 'resolveOrgProbe',
      seed: { defaultOrgId: 'provider-org' },
      env: { ZITADEL_DEFAULT_ORG_ID: 'env-org' },
    }).then((v) => {
      expect(v.outcome.org).to.equal('env-org');
    });
  });
});
