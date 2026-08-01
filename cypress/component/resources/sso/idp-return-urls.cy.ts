// cypress/component/resources/sso/idp-return-urls.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/idp-return-urls.test.ts.
// idpReturnUrls is pure URL building (basename + requestId/link threading) → browser-side Chai.
import { idpReturnUrls, APP_BASENAME, POLICY_ORG_PURPOSE } from '@/resources/sso/idp-return-urls';
import { signParam } from '@/server/signed-param';

describe('idpReturnUrls', () => {
  it('includes the /id basename so the IdP broker redirect hits the real route (regression: 404)', () => {
    const { success, failure } = idpReturnUrls('http://localhost:3000', 'google');
    expect(success).to.equal('http://localhost:3000/id/sso/google/callback');
    expect(failure).to.equal('http://localhost:3000/id/sso/google/error');
    expect(success.startsWith(`http://localhost:3000${APP_BASENAME}/sso/`)).to.equal(true);
  });

  it('carries the requestId so the callback can resume /authorize (regression: stuck at /signed-in)', () => {
    const { success } = idpReturnUrls('http://localhost:3000', 'google', {
      requestId: 'oidc_V2_123',
      organization: 'org-1',
    });
    expect(success).to.equal(
      'http://localhost:3000/id/sso/google/callback?requestId=oidc_V2_123&organization=org-1'
    );
  });

  it('carries the deviceTrackingToken so the callback can attach it to the session (IdP fraud-signal parity)', () => {
    const { success } = idpReturnUrls('http://localhost:3000', 'google', {
      deviceTrackingToken: 'mm-token-abc',
    });
    expect(success).to.equal(
      'http://localhost:3000/id/sso/google/callback?deviceTrackingToken=mm-token-abc'
    );
  });

  it('carries requestId/organization on the FAILURE url too, so a failed IdP round-trip can still resume the ceremony (regression: dead-end on IdP failure)', () => {
    const { failure } = idpReturnUrls('http://localhost:3000', 'google', {
      requestId: 'oidc_V2_123',
      organization: 'org-1',
    });
    expect(failure).to.equal(
      'http://localhost:3000/id/sso/google/error?requestId=oidc_V2_123&organization=org-1'
    );
  });

  it('omits the failure query entirely when no requestId/organization is present (no bare "?")', () => {
    const { failure } = idpReturnUrls('http://localhost:3000', 'google');
    expect(failure).to.equal('http://localhost:3000/id/sso/google/error');
  });

  it('carries a policyOrg that DIFFERS from organization, so the callback gates allowRegister in the deciding org', () => {
    // /login/method picks a sole linked IdP out of a list resolved for the FOUND USER's org while
    // the ceremony `organization` is still absent. Without this param the callback resolved
    // allowRegister (and the auto-create org) from the DEFAULT org instead — a different policy
    // from the one that offered the provider.
    const { success } = idpReturnUrls('http://localhost:3000', 'google', {
      policyOrg: 'org-mia',
    });
    // SIGNED, and signed here at the START. This param is the only one on the URL that is not
    // already coupled to something the attacker would also have to get right (see the note in
    // idp-return-urls.ts), so the callback trusts provenance rather than shape — which means the
    // producer must always emit the pair. Asserted through signParam rather than a literal so the
    // spec pins the PAIRING, not one particular digest.
    const sig = signParam(POLICY_ORG_PURPOSE, 'org-mia');
    expect(sig, 'a signature is actually produced').to.be.a('string').and.not.be.empty;
    expect(success).to.equal(
      `http://localhost:3000/id/sso/google/callback?policyOrg=org-mia&policyOrgSig=${encodeURIComponent(sig)}`
    );
  });

  it('never emits a bare policyOrg — an unsigned one is exactly what the callback refuses', () => {
    // Regression guard on the producer half: dropping the signature here would not break any
    // sign-in (the callback silently falls back to `organization`), it would just quietly restore
    // the default-org policy divergence policyOrg exists to fix. Fail loudly instead.
    const { success } = idpReturnUrls('http://localhost:3000', 'google', {
      organization: 'org-1',
      policyOrg: 'org-mia',
      requestId: 'oidc_1',
    });
    const params = new URL(success).searchParams;
    expect(params.get('policyOrg')).to.equal('org-mia');
    expect(params.get('policyOrgSig'), 'signature rides with the value').to.equal(
      signParam(POLICY_ORG_PURPOSE, 'org-mia')
    );
  });

  it('omits policyOrg when it is identical to organization (no redundant param)', () => {
    const { success } = idpReturnUrls('http://localhost:3000', 'google', {
      organization: 'org-1',
      policyOrg: 'org-1',
    });
    expect(success).to.equal('http://localhost:3000/id/sso/google/callback?organization=org-1');
  });

  it('failure url never carries policyOrg/link/deviceTrackingToken (success-path-only concerns)', () => {
    const { failure } = idpReturnUrls('http://localhost:3000', 'google', {
      link: true,
      policyOrg: 'org-mia',
      deviceTrackingToken: 'mm-token-abc',
    });
    expect(failure).to.equal('http://localhost:3000/id/sso/google/error');
  });
});
