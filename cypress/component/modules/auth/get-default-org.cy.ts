// cypress/component/modules/auth/get-default-org.cy.ts
//
// getDefaultOrg() — the provider capability behind the org-first / default-org fallback.
// Fake: returns a stable (configurable) id. Zitadel: maps the first ListOrganizations result id,
// driven via the transport stub's __setCreateServiceClientImpl hook (same seam index.cy.ts uses).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { ZitadelAuthProvider } from '@/modules/auth/providers/zitadel/index';
import * as transport from '@/modules/auth/providers/zitadel/transport';

const zprovider = () =>
  new ZitadelAuthProvider({ serviceUrl: 'https://z.test', serviceToken: 't' });

const stubClient = (impl: Record<string, unknown>) =>
  (
    transport as unknown as { __setCreateServiceClientImpl: (fn: unknown) => void }
  ).__setCreateServiceClientImpl(() => impl);

afterEach(() => {
  (
    transport as unknown as { __resetCreateServiceClientImpl: () => void }
  ).__resetCreateServiceClientImpl();
});

describe('FakeAuthProvider — getDefaultOrg', () => {
  it('returns a stable fake default org id by default, and is overridable at runtime (incl. the no-default-org branch)', async () => {
    expect(await new FakeAuthProvider().getDefaultOrg()).to.equal('org-default-fake');
    const p = new FakeAuthProvider();
    p.setDefaultOrg('org-x');
    expect(await p.getDefaultOrg()).to.equal('org-x');
    p.setDefaultOrg(null);
    expect(await p.getDefaultOrg()).to.equal(null);
  });
});

describe('ZitadelAuthProvider — getDefaultOrg', () => {
  it('maps the id of the first ListOrganizations result, or returns null when there is no result', async () => {
    stubClient({
      listOrganizations: async () => ({
        result: [{ id: '325848896225939482' }, { id: 'other-org' }],
      }),
    });
    expect(await zprovider().getDefaultOrg()).to.equal('325848896225939482');

    stubClient({ listOrganizations: async () => ({ result: [] }) });
    expect(await zprovider().getDefaultOrg()).to.equal(null);
  });
});
