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

  const REQ = encodeURIComponent('oidc_V3-current');

  it('carries an allowlisted requestId — and the ceremony organization when present — onto the /accounts redirect', () => {
    // No organization: asserted with an EXACT equal, which also proves no stray params are
    // appended. This is why it is not folded into the include-based case below.
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
      expect(o.kind, 'requestId only: redirect').to.equal('redirect');
      expect(o.location, 'requestId only: exact target').to.equal(`/accounts?requestId=${REQ}`);
    });

    // With organization (regression: removeSchema dropped it). Both the ceremony id AND the
    // org scope must survive, so "Add an account"/signup after a remove resolves the correct
    // org instead of falling back to the default.
    callService({
      fn: 'removeAccount',
      seed,
      liveSessions,
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: {
          intent: 'remove',
          sessionId: 's1',
          requestId: 'oidc_V3-current',
          organization: 'org-1',
        },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind, 'with org: redirect').to.equal('redirect');
      expect(o.location, 'with org: requestId survives').to.include(`requestId=${REQ}`);
      expect(o.location, 'with org: org scope survives').to.include('organization=org-1');
    });
  });

  // The drop half of the allowlist, which the file header has claimed since it was written
  // but nothing asserted. REQUEST_ID_PATTERN is /^(oidc|saml|device)_/ — anything else is
  // attacker-supplied text that must never be reflected into a redirect the user follows.
  // Without this, a build that threaded the form value verbatim passed every existing test.
  const REJECTED: [label: string, requestId: string][] = [
    ['an unknown prefix', 'evil_x'],
    ['an absolute URL smuggled as a requestId', 'evil_https://evil.example/steal'],
    ['a bare value with no prefix at all', 'V3-current'],
  ];

  it('drops a requestId that fails the prefix allowlist, redirecting to a bare /accounts rather than reflecting it', () => {
    for (const [label, requestId] of REJECTED) {
      callService({
        fn: 'removeAccount',
        seed,
        liveSessions,
        request: {
          url: 'http://localhost/id/accounts',
          sessions: cookie,
          form: { intent: 'remove', sessionId: 's1', requestId },
        },
      }).then((v) => {
        const o = v.outcome as Outcome;
        expect(o.kind, `${label}: redirect`).to.equal('redirect');
        expect(o.location, `${label}: value not reflected`).to.equal('/accounts');
      });
    }
  });
});
