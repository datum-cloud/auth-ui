// cypress/component/modules/auth/session/cookie.guard.cy.ts
//
// Node-bound (cy.task) port of app/modules/auth/session/__tests__/cookie.guard.test.ts.
//
// readSessions(request) is a SECURITY gate (HMAC signature + Zod-shape guard with audit). The
// cookie module is stubbed out of the Vite browser bundle (env.server + react-router signing),
// and the Fetch spec forbids setting a Cookie header in the browser — so the REAL guard runs in
// Bun via cy.task. Each op runs ONE readSessions call; logAuthEvent's console.log audit is
// captured into verdict.auditLines (the cy.task analogue of the original `vi.spyOn(console,'log')`).
import { callService } from '../../../../support/node/call-service';
import type { Verdict } from '../../../../support/node/call-service';

const sessionCookieAudit = (v: Verdict): string[] =>
  v.auditLines.filter((l) => l.includes('session_cookie'));

describe('readSessions zod guard (P0 carry-over)', () => {
  it('valid signed entries round-trip unchanged', () => {
    callService({
      fn: 'cookieGuardCheck',
      cookieGuardOp: 'validRoundTrip',
      request: { url: 'http://localhost/id/accounts' },
    }).then((v) => {
      expect((v.outcome as { count: number }).count).to.equal(1);
      expect((v.outcome as { firstId: string }).firstId).to.equal('s1');
      expect(sessionCookieAudit(v)).to.have.length(0);
    });
  });

  it('absent cookie header → [] with NO audit signal', () => {
    callService({
      fn: 'cookieGuardCheck',
      cookieGuardOp: 'absent',
      request: { url: 'http://localhost/id/accounts' },
    }).then((v) => {
      expect((v.outcome as { count: number }).count).to.equal(0);
      expect(sessionCookieAudit(v)).to.have.length(0);
    });
  });

  it('tampered signature → [] + invalid_signature audit', () => {
    callService({
      fn: 'cookieGuardCheck',
      cookieGuardOp: 'tamperedSignature',
      request: { url: 'http://localhost/id/accounts' },
    }).then((v) => {
      expect((v.outcome as { count: number }).count).to.equal(0);
      const lines = sessionCookieAudit(v);
      expect(lines).to.have.length(1);
      expect(lines[0]).to.include('invalid_signature');
    });
  });

  it('validly-signed wrong-shape payload → [] + malformed_payload audit', () => {
    callService({
      fn: 'cookieGuardCheck',
      cookieGuardOp: 'forgedWrongShape',
      request: { url: 'http://localhost/id/accounts' },
    }).then((v) => {
      expect((v.outcome as { count: number }).count).to.equal(0);
      const lines = sessionCookieAudit(v);
      expect(lines).to.have.length(1);
      expect(lines[0]).to.include('malformed_payload');
    });
  });

  it('validly-signed non-array payload → [] + malformed_payload audit', () => {
    callService({
      fn: 'cookieGuardCheck',
      cookieGuardOp: 'forgedNonArray',
      request: { url: 'http://localhost/id/accounts' },
    }).then((v) => {
      expect((v.outcome as { count: number }).count).to.equal(0);
      expect(sessionCookieAudit(v)).to.have.length(1);
    });
  });
});
