// cypress/component/resources/session/session.service.accounts.cy.ts
//
// cy.task node-spec port of app/resources/session/__tests__/session.service.accounts.test.ts.
// listAccounts reads the signed `sessions` cookie, so it is node-bound. Pins the listAuthMethods
// N+1 dedupe: one RPC per DISTINCT userId across the cookie sessions (recorded via the harness's
// recordCalls wrapper — the cy.task equivalent of the original vi.fn spy).
import { callService } from '../../../support/node/call-service';

// The slice of the real EnrichedAccount the assertions read.
type Account = { sessionId: string; displayName?: string };

describe('listAccounts — listAuthMethods N+1 dedupe', () => {
  it('issues ONE listAuthMethods per distinct userId across multiple sessions', () => {
    const alice = { id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' };
    callService({
      fn: 'listAccounts',
      provider: 'fresh',
      liveSessions: [
        { id: 's1', token: 'tok-s1', user: alice },
        { id: 's2', token: 'tok-s2', user: alice },
      ],
      recordCalls: ['listAuthMethods'],
      request: {
        url: 'http://localhost/id/accounts',
        sessions: [
          { id: 's1', token: 'tok-s1', loginName: 'alice@acme.test', organization: 'org-a' },
          { id: 's2', token: 'tok-s2', loginName: 'alice@acme.test', organization: 'org-b' },
        ],
      },
    }).then((v) => {
      const calls = v.calls?.listAuthMethods ?? [];
      expect(calls.length).to.equal(1);
      expect(calls[0][0]).to.equal('u1');
      const accounts = v.outcome as Account[];
      expect(accounts).to.have.length(2);
      expect(accounts.map((a) => a.sessionId).sort()).to.deep.equal(['s1', 's2']);
      expect(accounts.every((a) => a.displayName === 'Alice')).to.equal(true);
    });
  });
});

describe('listAccounts — dead-end sessions', () => {
  const user = { id: 'u-new', loginName: 'new@acme.test', displayName: 'New' };
  const cookie = [{ id: 's-signup', token: 't-signup', loginName: 'new@acme.test' }];

  function accountsFor(methods: string[], factorKinds: Array<'otpEmail' | 'passkey'>) {
    return callService({
      fn: 'listAccounts',
      provider: 'fresh',
      seed: { authMethods: { [user.id]: methods } },
      liveSessions: [{ id: 's-signup', token: 't-signup', user, factorKinds }],
      request: { url: 'http://localhost/id/accounts', sessions: cookie },
    }).then((v) => (v.outcome as Account[]).map((a) => a.sessionId));
  }

  it('hides an otpEmail-only session whose account has no primary method (abandoned signup)', () => {
    accountsFor(['otp_email'], ['otpEmail']).then((ids) => expect(ids).to.deep.equal([]));
  });

  it('keeps an otpEmail-only session once a passkey is enrolled (it can resume on /login/passkey)', () => {
    accountsFor(['passkey', 'otp_email'], ['otpEmail']).then((ids) =>
      expect(ids).to.deep.equal(['s-signup'])
    );
  });

  it('keeps a passkey-verified session', () => {
    accountsFor(['passkey', 'otp_email'], ['otpEmail', 'passkey']).then((ids) =>
      expect(ids).to.deep.equal(['s-signup'])
    );
  });
});
