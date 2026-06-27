// cypress/component/resources/session/session.service.logout.cy.ts
//
// cy.task node-spec port of app/resources/session/__tests__/session.service.logout.test.ts.
// performLogout reads the signed `sessions` cookie to find the active session, so it is node-bound.
// Residual-session guard: after single-session logout with residual sessions left, the redirect
// must force explicit account selection (/accounts or prompt=select_account), never /logout/success.
import { callService } from '../../../support/node/call-service';

const s1 = {
  id: 'sess-1',
  token: 'tok-1',
  loginName: 'alice@acme.test',
  creationTs: '2026-01-01T00:00:00.000Z',
  expirationTs: '2099-01-01T00:00:00.000Z',
  changeTs: '2026-01-02T00:00:00.000Z', // most recent → active
};
const s2 = {
  id: 'sess-2',
  token: 'tok-2',
  loginName: 'bob@acme.test',
  creationTs: '2026-01-01T00:00:00.000Z',
  expirationTs: '2099-01-01T00:00:00.000Z',
  changeTs: '2026-01-01T00:00:00.000Z', // older → residual
};

describe('performLogout — explicit session scope', () => {
  it('after single-session logout, residual sessions are not silently reused on resume', () => {
    callService({
      fn: 'performLogout',
      provider: 'singleton',
      request: { url: 'http://localhost/id/logout', sessions: [s1, s2] },
    }).then((v) => {
      const o = v.outcome as { location: string };
      expect(o.location).to.match(/prompt=select_account|\/accounts/);
      // Thin route-wiring check: the translator emits the same Location verbatim.
      expect(v.response?.location ?? '').to.match(/prompt=select_account|\/accounts/);
    });
  });

  it('single-session logout (no residual) still redirects to /logout/success', () => {
    callService({
      fn: 'performLogout',
      provider: 'singleton',
      request: { url: 'http://localhost/id/logout', sessions: [s1] },
    }).then((v) => {
      const o = v.outcome as { location: string };
      expect(o.location).to.include('/logout/success');
      expect(v.response?.location ?? '').to.include('/logout/success');
    });
  });
});
