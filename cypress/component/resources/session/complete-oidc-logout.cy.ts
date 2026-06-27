// cypress/component/resources/session/complete-oidc-logout.cy.ts
//
// cy.task node-spec port of app/resources/session/__tests__/complete-oidc-logout.test.ts.
// completeOidcLogout reads the signed `sessions` cookie to delete EVERY v2 session, so it is
// node-bound. The harness records deleteSession call args (recordCalls) and can force a throw
// (failDeleteSession) — the cy.task equivalents of the original vi.fn provider double.
import { callService } from '../../../support/node/call-service';

describe('completeOidcLogout', () => {
  it('deletes ALL v2 sessions and clears the cookie', () => {
    callService({
      fn: 'completeOidcLogout',
      provider: 'singleton',
      recordCalls: ['deleteSession'],
      request: {
        url: 'https://auth.localtest.me:30000/id/logout',
        sessions: [
          { id: 's1', token: 't1', loginName: 'a@x.test' },
          { id: 's2', token: 't2', loginName: 'b@x.test' },
        ],
      },
    }).then((v) => {
      const calls = v.calls?.deleteSession ?? [];
      expect(calls.length).to.equal(2);
      expect(calls).to.deep.include(['s1', 't1']);
      expect(calls).to.deep.include(['s2', 't2']);
      const o = v.outcome as { location: string; setCookie: string };
      expect(o.setCookie).to.include('sessions=');
      expect(o.location).to.equal('/logout/success');
    });
  });

  it('tolerates provider deleteSession failures (best-effort) and still clears + redirects', () => {
    callService({
      fn: 'completeOidcLogout',
      provider: 'singleton',
      failDeleteSession: true,
      request: {
        url: 'https://auth.localtest.me:30000/id/logout',
        sessions: [{ id: 's1', token: 't1', loginName: 'a@x.test' }],
      },
    }).then((v) => {
      const o = v.outcome as { location: string };
      expect(o.location).to.equal('/logout/success');
    });
  });

  it('rejects a relative post_logout_redirect and falls back to /logout/success', () => {
    callService({
      fn: 'completeOidcLogout',
      provider: 'singleton',
      request: {
        url: 'https://auth.localtest.me:30000/id/logout?logout_token=x&post_logout_redirect=/logout/done',
        sessions: [{ id: 's1', token: 't1', loginName: 'a@x.test' }],
      },
    }).then((v) => {
      const o = v.outcome as { location: string };
      expect(o.location).to.equal('/logout/success');
    });
  });
});
