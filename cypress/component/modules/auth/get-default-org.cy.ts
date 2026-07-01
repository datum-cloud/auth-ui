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
  it('returns a stable fake default org id by default', async () => {
    expect(await new FakeAuthProvider().getDefaultOrg()).to.equal('org-default-fake');
  });

  it('returns the seeded defaultOrgId when provided', async () => {
    expect(await new FakeAuthProvider({ defaultOrgId: 'org-seed' }).getDefaultOrg()).to.equal(
      'org-seed'
    );
  });

  it('returns null when seeded null (the no-default-org / last-resort branch)', async () => {
    expect(await new FakeAuthProvider({ defaultOrgId: null }).getDefaultOrg()).to.equal(null);
  });

  it('is overridable at runtime via setDefaultOrg', async () => {
    const p = new FakeAuthProvider();
    p.setDefaultOrg('org-x');
    expect(await p.getDefaultOrg()).to.equal('org-x');
    p.setDefaultOrg(null);
    expect(await p.getDefaultOrg()).to.equal(null);
  });
});

describe('ZitadelAuthProvider — getDefaultOrg', () => {
  it('maps the id of the first ListOrganizations result (the instance Default Organization)', async () => {
    stubClient({
      listOrganizations: async () => ({
        result: [{ id: '325848896225939482' }, { id: 'other-org' }],
      }),
    });
    expect(await zprovider().getDefaultOrg()).to.equal('325848896225939482');
  });

  it('returns null when ListOrganizations yields no result', async () => {
    stubClient({ listOrganizations: async () => ({ result: [] }) });
    expect(await zprovider().getDefaultOrg()).to.equal(null);
  });

  it('filters ListOrganizations by the instance defaultQuery', async () => {
    let captured: { queries?: Array<{ query?: { case?: string } }> } | undefined;
    stubClient({
      listOrganizations: async (req: { queries?: Array<{ query?: { case?: string } }> }) => {
        captured = req;
        return { result: [{ id: 'o1' }] };
      },
    });
    await zprovider().getDefaultOrg();
    expect(captured?.queries?.[0]?.query?.case).to.equal('defaultQuery');
  });
});
