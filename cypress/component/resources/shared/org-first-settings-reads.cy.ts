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
  // One contract exercised twice — raw org EMPTY vs PRESENT. Same call, same three
  // assertions; only the URL and the expected org / default-lookup count vary. Each row is
  // its own cy.task (fresh Bun process), so the recorded-call arrays cannot couple.
  const CASES: [label: string, query: string, expectedOrg: string, defaultOrgCalls: number][] = [
    ['NO ?organization', '', 'org-default-fake', 1],
    ['explicit ?organization', '&organization=org-explicit', 'org-explicit', 0],
  ];

  it('resolves the org org-first for both reads: an explicit ?organization wins and skips the provider default, an empty one falls back to it', () => {
    for (const [label, query, expectedOrg, defaultOrgCalls] of CASES) {
      callService({
        fn: 'loginMethodLoader',
        provider: 'singleton',
        request: {
          url: `http://localhost/id/login/method?loginName=${ALICE}${query}`,
          // The chooser loader is session-gated: it only identifies a user the ceremony has
          // already planted a LIVE session for (the identifier step writes it on the same
          // response that redirects here).
          sessions: [{ id: 's1', token: 'tok-s1', loginName: ALICE }],
        },
        recordCalls: ['getDefaultOrg', 'getLoginSettings', 'getBranding'],
      }).then((v) => {
        expect(v.calls?.getDefaultOrg, `${label}: getDefaultOrg lookups`).to.have.length(
          defaultOrgCalls
        );
        expect(v.calls?.getLoginSettings?.[0]?.[0], `${label}: getLoginSettings org`).to.equal(
          expectedOrg
        );
        expect(v.calls?.getBranding?.[0]?.[0], `${label}: getBranding org`).to.equal(expectedOrg);
      });
    }
  });
});

describe('resolveIdentifier — post-identifier policy org agrees with the chooser', () => {
  // The identifier step decides a user HAS a usable method and routes them to /login/method,
  // whose loader then RE-computes that availability. If the two read a different org's policy the
  // loader can compute `available: []` for a user the decision just approved and bounce them to
  // /error. They previously agreed only for users WITH an orgId: `User.orgId` is OPTIONAL, and
  // when it was absent this side fell through to INSTANCE settings (getLoginSettings(undefined))
  // while the chooser fell through to the DEFAULT ORG's. alice has no orgId, so she is exactly
  // that case.
  it('with NO ?organization AND no user.orgId, reads the DEFAULT org (not instance settings)', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: ALICE },
        csrf: true,
      },
      recordCalls: ['getLoginSettings'],
    }).then((v) => {
      // LAST call, not a fixed index: resolveIdentifier's domain-discovery probe reads the
      // BASE/instance settings first by design (the org isn't known yet), so the post-identifier
      // read is the final one.
      const orgArgs = (v.calls?.getLoginSettings ?? []).map((args) => args[0]);
      expect(orgArgs.length, 'the post-identifier settings read ran').to.be.greaterThan(1);
      expect(orgArgs.at(-1), 'must not fall through to INSTANCE settings').to.equal(
        'org-default-fake'
      );
      // And the decision still routes to the chooser rather than a policy dead end.
      expect(v.response?.location ?? '').to.contain('/login/method');
    });
  });

  it('a user WITH an orgId still gets their OWN org, never the default', () => {
    callService({
      fn: 'loginAction',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test', orgId: 'org-mia' }],
        authMethods: { u1: ['password'] },
      },
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: 'mia@acme.test' },
        csrf: true,
      },
      recordCalls: ['getLoginSettings'],
    }).then((v) => {
      const orgArgs = (v.calls?.getLoginSettings ?? []).map((args) => args[0]);
      expect(orgArgs.at(-1)).to.equal('org-mia');
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
