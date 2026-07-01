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
import {
  resolveOrg,
  getCachedDefaultOrg,
  resetDefaultOrgCache,
} from '@/resources/shared/resolve-org';

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

  it('with no urlOrg (and no env pin) falls back to the provider default org', async () => {
    const { provider, getCalls } = stubProvider(() => 'default-org');
    expect(await resolveOrg(provider)).to.equal('default-org');
    expect(getCalls()).to.equal(1);
  });

  it('caches the default org — getDefaultOrg is called once across repeated resolveOrg calls', async () => {
    const { provider, getCalls } = stubProvider(() => 'default-org');
    expect(await resolveOrg(provider)).to.equal('default-org');
    expect(await resolveOrg(provider)).to.equal('default-org');
    expect(getCalls()).to.equal(1);
  });

  it('returns undefined (INSTANCE/default last resort) when the provider has no default org', async () => {
    const { provider } = stubProvider(() => null);
    expect(await resolveOrg(provider)).to.equal(undefined);
  });
});

describe('getCachedDefaultOrg — a null result is NOT cached (retries)', () => {
  beforeEach(() => resetDefaultOrgCache());

  it('retries after null, then caches the first non-null id', async () => {
    let ret: string | null = null;
    const { provider, getCalls } = stubProvider(() => ret);

    // 1st: null — returned but not cached.
    expect(await getCachedDefaultOrg(provider)).to.equal(null);
    // 2nd: provider now has a default — the retry picks it up (proof null was not cached).
    ret = 'later-org';
    expect(await getCachedDefaultOrg(provider)).to.equal('later-org');
    expect(getCalls()).to.equal(2);

    // 3rd: non-null is now cached — even a changed provider value is not re-read.
    ret = 'changed-org';
    expect(await getCachedDefaultOrg(provider)).to.equal('later-org');
    expect(getCalls()).to.equal(2);
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

  it('an explicit urlOrg still wins over the env pin', () => {
    callService({
      fn: 'resolveOrgProbe',
      seed: { defaultOrgId: 'provider-org' },
      env: { ZITADEL_DEFAULT_ORG_ID: 'env-org' },
      resolveOrgInput: { urlOrg: 'url-org' },
    }).then((v) => {
      expect(v.outcome.org).to.equal('url-org');
    });
  });

  it('with no urlOrg and no env pin, falls back to the provider default org', () => {
    callService({
      fn: 'resolveOrgProbe',
      seed: { defaultOrgId: 'provider-org' },
    }).then((v) => {
      expect(v.outcome.org).to.equal('provider-org');
    });
  });

  it('returns null when there is no urlOrg, no env pin, and no provider default org', () => {
    callService({
      fn: 'resolveOrgProbe',
      seed: { defaultOrgId: null },
    }).then((v) => {
      expect(v.outcome.org).to.equal(null);
    });
  });
});
