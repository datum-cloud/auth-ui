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

  it('issues one listAuthMethods PER distinct userId when sessions belong to different users', () => {
    callService({
      fn: 'listAccounts',
      provider: 'fresh',
      liveSessions: [
        { id: 's1', token: 'tok-s1', user: { id: 'u1', loginName: 'alice@acme.test' } },
        { id: 's2', token: 'tok-s2', user: { id: 'u2', loginName: 'bob@acme.test' } },
      ],
      recordCalls: ['listAuthMethods'],
      request: {
        url: 'http://localhost/id/accounts',
        sessions: [
          { id: 's1', token: 'tok-s1', loginName: 'alice@acme.test', organization: 'org-a' },
          { id: 's2', token: 'tok-s2', loginName: 'bob@acme.test', organization: 'org-a' },
        ],
      },
    }).then((v) => {
      const calls = v.calls?.listAuthMethods ?? [];
      expect(calls.length).to.equal(2);
      expect(calls.map((c) => c[0]).sort()).to.deep.equal(['u1', 'u2']);
      expect(v.outcome as Account[]).to.have.length(2);
    });
  });

  it('does not call listAuthMethods for a session with no resolved userId', () => {
    callService({
      fn: 'listAccounts',
      provider: 'fresh',
      liveSessions: [{ id: 's1', token: 'tok-s1' }], // no user → userId ''
      recordCalls: ['listAuthMethods'],
      request: {
        url: 'http://localhost/id/accounts',
        sessions: [
          { id: 's1', token: 'tok-s1', loginName: 'alice@acme.test', organization: 'org-a' },
        ],
      },
    }).then((v) => {
      expect(v.calls?.listAuthMethods ?? []).to.have.length(0);
      const accounts = v.outcome as Account[];
      expect(accounts).to.have.length(1);
      expect(accounts[0].sessionId).to.equal('s1');
    });
  });
});
