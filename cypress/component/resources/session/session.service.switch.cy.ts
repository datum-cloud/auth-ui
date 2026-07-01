// cypress/component/resources/session/session.service.switch.cy.ts
//
// cy.task node-spec port of app/resources/session/__tests__/session.service.switch.test.ts.
// switchAccount/removeAccount read the signed `sessions` cookie off the Request, so they are
// node-bound. SECURITY: the CURRENT ceremony requestId must come from the form field (allowlisted),
// never the stale cookie one — and a non-allowlisted value (`evil_https://…` / `evil_x`) is dropped.
import { callService } from '../../../support/node/call-service';

const ALICE = { id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' };

type Outcome = {
  kind: string;
  location?: string;
  error?: string;
  status?: number;
  cookies?: string[];
};

describe('switchAccount — 755-M10 MFA-setup nudge suppression', () => {
  it('switches a no-MFA user to /signed-in instead of the skippable /setup/mfa nudge', () => {
    callService({
      fn: 'switchAccount',
      seed: {
        users: [ALICE],
        authMethods: { u1: [] },
        settingsByOrg: { 'nudge-org': { mfaInitSkipLifetimeMs: 10_000 } },
      },
      liveSessions: [{ id: 's1', token: 'tok-s1', user: ALICE }],
      request: {
        url: 'http://localhost/id/accounts',
        sessions: [
          { id: 's1', token: 'tok-s1', loginName: 'alice@acme.test', organization: 'nudge-org' },
        ],
        form: { intent: 'switch', sessionId: 's1' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.match(/^\/signed-in(\?|$)/);
      expect(o.location).to.not.include('/setup/mfa');
    });
  });
});

describe('removeAccount — ceremony requestId threading', () => {
  const seed = { users: [ALICE] };
  const liveSessions = [{ id: 's1', token: 'tok-s1', user: ALICE }];
  const cookie = [{ id: 's1', token: 'tok-s1', loginName: 'alice@acme.test' }];

  it('carries an allowlisted requestId onto the /accounts redirect', () => {
    callService({
      fn: 'removeAccount',
      seed,
      liveSessions,
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'remove', sessionId: 's1', requestId: 'oidc_V3-current' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal(`/accounts?requestId=${encodeURIComponent('oidc_V3-current')}`);
    });
  });
});
