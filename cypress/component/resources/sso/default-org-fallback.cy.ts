// cypress/component/resources/sso/default-org-fallback.cy.ts
//
// Part 2 of the org-first / default-org fallback fix: the SSO IdP-DISPLAY flows. Before this fix the
// SSO flows called `provider.getActiveIdPs(organization)` with a RAW org — empty when the SSO-link is
// entered without `?organization=` — so they fell back to the INSTANCE/default IdPs (the wrong
// duplicates) instead of the Datum Cloud ORG IdPs. Every display read now routes through the single
// `getActiveIdPs` choke point (app/resources/sso/idp-providers.ts), which resolves the org org-first
// with a default-org fallback: an explicit org (URL/payload) WINS, an empty one falls back to the
// provider's instance Default Organization ('org-default-fake' on the seeded fake). Node-bound: each
// flow reads a real Request + the seeded fake provider; recordCalls captures the org arg.
import { callService } from '../../../support/node/call-service';

const RECORD = ['getDefaultOrg', 'getActiveIdPs'] as const;

describe('SSO IdP-display flows — org-first / default-org fallback', () => {
  describe('idp-providers wrapper (the choke point)', () => {
    it('with NO org, threads the resolved default org into getActiveIdPs (not undefined)', () => {
      callService({
        fn: 'activeIdPsProbe',
        provider: 'singleton',
        request: { url: 'http://localhost/id/sso' },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(1);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-default-fake');
      });
    });

    it('with an explicit org, uses it and never consults the provider default org', () => {
      callService({
        fn: 'activeIdPsProbe',
        provider: 'singleton',
        request: { url: 'http://localhost/id/sso' },
        resolveOrgInput: { urlOrg: 'org-explicit' },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(0);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-explicit');
      });
    });
  });

  describe('runSsoAction (start intent)', () => {
    it('with NO organization, resolves the default org for the active-IdP lookup', () => {
      callService({
        fn: 'runSsoAction',
        provider: 'singleton',
        request: { url: 'http://localhost/id/sso', form: { intent: 'start', provider: 'google' } },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(1);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-default-fake');
      });
    });

    it('with an explicit organization, preserves it (provider default unused)', () => {
      callService({
        fn: 'runSsoAction',
        provider: 'singleton',
        request: {
          url: 'http://localhost/id/sso',
          form: { intent: 'start', provider: 'google', organization: 'org-explicit' },
        },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(0);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-explicit');
      });
    });
  });

  describe('resolveSsoLink (sign-in-required prompt)', () => {
    it('with NO ?organization and no session, resolves the default org for the IdP list', () => {
      callService({
        fn: 'resolveSsoLink',
        provider: 'singleton',
        request: { url: 'http://localhost/id/sso/link' },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(1);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-default-fake');
      });
    });

    it('with an explicit ?organization, preserves it (provider default unused)', () => {
      callService({
        fn: 'resolveSsoLink',
        provider: 'singleton',
        request: { url: 'http://localhost/id/sso/link?organization=org-explicit' },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(0);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-explicit');
      });
    });
  });

  describe('resolveSsoManagement (/sso screen)', () => {
    it('with NO ?organization, resolves the default org before listing/joining IdPs', () => {
      callService({
        fn: 'resolveSsoManagement',
        provider: 'singleton',
        request: { url: 'http://localhost/id/sso' },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(1);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-default-fake');
      });
    });

    it('with an explicit ?organization, preserves it (provider default unused)', () => {
      callService({
        fn: 'resolveSsoManagement',
        provider: 'singleton',
        request: { url: 'http://localhost/id/sso?organization=org-explicit' },
        recordCalls: [...RECORD],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg).to.have.length(0);
        expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-explicit');
      });
    });
  });
});
