// cypress/component/resources/sso/idp-providers.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/idp-providers.test.ts.
// getActiveIdPs is the real capability-gated wrapper; the provider is a cy.stub dependency
// double (NOT a logic double) so we exercise the real guard browser-side.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { IdProvider } from '@/modules/auth/types';
import { getActiveIdPs } from '@/resources/sso/idp-providers';

const sampleIdPs: IdProvider[] = [
  { id: 'idp-g', name: 'Google', type: 'GOOGLE' },
  { id: 'idp-gh', name: 'GitHub', type: 'GITHUB' },
];

function makeProvider(externalIdp: boolean) {
  const getActiveIdPsStub = cy.stub().resolves(sampleIdPs);
  const provider = {
    capabilities: { externalIdp },
    getActiveIdPs: getActiveIdPsStub,
  } as unknown as AuthProvider;
  return { provider, getActiveIdPsStub };
}

describe('getActiveIdPs', () => {
  it("returns the provider's active IdPs for the org when externalIdp is supported", () => {
    const { provider, getActiveIdPsStub } = makeProvider(true);
    return getActiveIdPs(provider, 'org-1').then((idps) => {
      expect(idps.map((i) => i.id)).to.deep.equal(['idp-g', 'idp-gh']);
      expect(getActiveIdPsStub).to.have.been.calledWith('org-1');
    });
  });

  it('returns [] without calling the port when externalIdp is unsupported', () => {
    const { provider, getActiveIdPsStub } = makeProvider(false);
    return getActiveIdPs(provider, 'org-1').then((idps) => {
      expect(idps).to.deep.equal([]);
      expect(getActiveIdPsStub).to.have.callCount(0);
    });
  });
});
