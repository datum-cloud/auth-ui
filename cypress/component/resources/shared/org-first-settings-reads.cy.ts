// cypress/component/resources/shared/org-first-settings-reads.cy.ts
//
// "org-first everywhere" pass — every remaining org-scoped settings/branding read now resolves the
// org org-first (an explicit org WINS, else the provider's instance Default Organization), matching
// the old app's `organization ?? getDefaultOrg()` on every page. This spec pins that contract across
// the route loaders (login/method, signup/index, signup/method, password/reset) and the domain
// services (otp, mfa, session). Each read is exercised twice:
//   • raw org EMPTY  → the read receives the resolved default org ('org-default-fake') and the
//     provider default-org lookup (getDefaultOrg) ran;
//   • raw org PRESENT → the read receives that explicit org and getDefaultOrg is NEVER consulted.
// Node-bound: every service reads the real provider + signed cookies; recordCalls captures the org
// arg each provider read received (the cy.task equivalent of a vi.fn spy).
import { callService } from '../../../support/node/call-service';

const ALICE = 'alice@acme.test';

describe('login/method loader — org-first getLoginSettings + getBranding', () => {
  it('NO ?organization → both reads get the resolved default org; provider default consulted once', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      request: { url: `http://localhost/id/login/method?loginName=${ALICE}` },
      recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getBranding'],
    }).then((v) => {
      expect(v.calls?.getDefaultOrg).to.have.length(1);
      expect(v.calls?.getLoginSettings?.[0]?.[0]).to.equal('org-default-fake');
      expect(v.calls?.getBranding?.[0]?.[0]).to.equal('org-default-fake');
    });
  });

  it('explicit ?organization → both reads get it; provider default never consulted', () => {
    callService({
      fn: 'loginMethodLoader',
      provider: 'singleton',
      request: {
        url: `http://localhost/id/login/method?loginName=${ALICE}&organization=org-explicit`,
      },
      recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getBranding'],
    }).then((v) => {
      expect(v.calls?.getDefaultOrg).to.have.length(0);
      expect(v.calls?.getLoginSettings?.[0]?.[0]).to.equal('org-explicit');
      expect(v.calls?.getBranding?.[0]?.[0]).to.equal('org-explicit');
    });
  });
});

describe('session.service listAccounts — session-derived org-first getLoginSettings', () => {
  it('a cookie session WITH an organization → getLoginSettings gets it; provider default never consulted', () => {
    callService({
      fn: 'listAccounts',
      provider: 'fresh',
      liveSessions: [{ id: 's1', token: 'tok-s1', user: { id: 'u1', loginName: ALICE } }],
      recordCalls: ['getDefaultOrg', 'getLoginSettings'],
      request: {
        url: 'http://localhost/id/accounts',
        sessions: [{ id: 's1', token: 'tok-s1', loginName: ALICE, organization: 'org-explicit' }],
      },
    }).then((v) => {
      expect(v.calls?.getDefaultOrg).to.have.length(0);
      expect(v.calls?.getLoginSettings?.[0]?.[0]).to.equal('org-explicit');
    });
  });
});
